import type { PrivateViewWindow } from '@pospay/contracts';
import {
  type PrivateViewDeadlines,
  closeAt,
  openedDeadlines,
  touchedDeadlines,
} from '../model/private-view-deadline';
import {
  type PinProblem,
  type PrivateWindowAction,
  type PrivateWindowState,
  reducePrivateWindow,
} from '../model/private-window-state';
import { WorkHttpError, sessionEnded, windowRefusal } from '../model/work-error';
import { PairedClock } from './private-window-clock';
import { concealPrivateRoot } from './private-window-conceal';
import { openWithin, type PrivateWindowDeps } from './private-window-env';
import { ExpiredView } from './private-window-expired-view';
import type { Scope, WindowHost } from './private-window-host';
import { attachWindowListeners } from './private-window-listeners';
import { loadMonth, loadMoreLines, retryTips } from './private-window-reads';
import { WindowTimers } from './private-window-timers';
import { TouchScheduler } from './private-window-touch';

/**
 * متحكم النافذة الخاصة على جهاز الاستقبال. القاعدة الوحيدة: أي خروج من الواجهة يقفل النافذة ويطلب الرقم السري.
 * (إخفاء، pagehide، freeze، resume، pageshow راجعة، blur، فك التركيب، تغيّر المشغّلة، موعد القفل،
 * رفض أو انتهاء من السيرفر، أو أي خطأ جوّاه): كل ده `close` بيرفع الجيل ويخفّي الحاوية فوراً ويمسح الذاكرة
 * ويلغي الطلبات والمؤقتات ويرجع لخطوة الـ PIN ويبعت إغلاق للسيرفر بأفضل جهد. أي رد بيوصل بجيل قديم
 * بيترمي (ورد الفتح القديم بيتقفل في السيرفر برقمه ومبيتعرضش)، وأي رد بيتطبّق بس لو الجيل هو
 * الحالي والموعد (اللي هيتحسب بعد الرد) ما فاتش والساعتين متفقتين وقت التطبيق. مفيش تخزين ولا كاش ولا تابات مشتركة.
 *
 * طلب الفتح واحد في المرة: السيرفر بيستبدل النافذة بآخر فتح بيوصله، فطلب قديم لسه ماردش ممكن يوصل بعد الجديد
 * ويقفله. عشان كده مفيش إرسال تاني لحد ما القديم يرد (وإغلاق نافذته القديمة يتجرّب)؛ وخطوة الـ PIN بتبان منتظرة.
 */
export class PrivateWindowController implements WindowHost {
  private gen = 0;
  private epoch = 0;
  private readSeq = 0;
  private abort = new AbortController();
  private alive = false;
  private openInFlight = false;
  private state: PrivateWindowState = { phase: 'pin', problem: null, epoch: 0, waiting: false };
  private readonly expired = new ExpiredView();
  private root: HTMLElement | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly clock: PairedClock;
  private readonly timers: WindowTimers;
  private readonly touches: TouchScheduler;

  constructor(
    readonly deps: PrivateWindowDeps,
    private readonly onLeave: () => void,
  ) {
    this.clock = new PairedClock(deps.env);
    this.timers = new WindowTimers(
      deps.env,
      () => this.state.phase === 'open' && this.dueAt(this.state.deadlines),
      () => this.close('expired'),
    );
    this.touches = new TouchScheduler(this, () => this.armDeadline());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * الحالة اللي الشاشة تعرضها (لقطة المتجر نفسها): النافذة المفتوحة بعد موعدها أو بعد نوم الجهاز بتظهر خطوة PIN
   * حتى لو المؤقت لسه ما اشتغلش، فأي رندر أو فحص تطابق قبل الـ commit بيشوفها. اللقطة ثابتة المرجع لنفس الحالة.
   * الحالة الخام الداخلية (`this.state`) هي اللي المؤقت والإغلاق بيشتغلوا عليها، فإغلاقه بيبلّغ المشتركين.
   */
  getState = (): PrivateWindowState => {
    const state = this.state;
    if (state.phase !== 'open' || !this.dueAt(state.deadlines)) return state;
    return this.expired.view(this.epoch);
  };

  /** بتسجّل حاوية العرض الخاص عشان القفل يخفّيها في نفس الحدث قبل ما React يطبّق. */
  attachRoot = (element: HTMLElement | null): void => {
    this.root = element;
  };

  /** بيركّب المستمعين من أول mount؛ والدالة المرجعة بتقفل وتشيل كل حاجة (فك التركيب). */
  start(): () => void {
    this.alive = true;
    const detach = attachWindowListeners(
      () => this.close('expired'),
      () => this.touches.input(),
      () => this.root,
    );
    return () => {
      this.alive = false;
      this.close(null);
      detach();
    };
  }

  /**
   * فتح النافذة بالـ PIN. الإرسال بيتقبل بس من نموذج دورته هي الحالية (بعد أي خروج النموذج القديم بيترفض)،
   * ومن غير طلب فتح تاني لسه مارجعش؛ والرد بيتطبّق بس لو الجيل لسه هو اللي بدأ.
   *
   * @param pin الأربع أرقام
   * @param epoch دورة النموذج اللي بعت
   */
  async submitPin(pin: string, epoch: number): Promise<void> {
    if (!this.canOpen(epoch)) return;
    const gen = this.gen;
    const sentAt = this.clock.capture();
    this.openInFlight = true;
    this.dispatch({ type: 'opening' });
    let opened: PrivateViewWindow;
    try {
      opened = await openWithin(this.deps, pin);
    } catch (error) {
      this.settleOpen();
      if (gen === this.gen) this.openFailed(error);
      return;
    }
    if (gen !== this.gen) {
      void this.closeRemote(opened.window_id);
      return this.settleOpen();
    }
    this.settleOpen();
    try {
      this.applyOpened(opened, sentAt);
    } catch {
      this.close('failed');
    }
  }

  stepMonth(month: string): void {
    this.restartReads({ type: 'month', month });
  }

  retry(): void {
    this.restartReads({ type: 'retry' });
  }

  /** إعادة قراءة الإكراميات بس بعد فشلها. */
  retryTips(): void {
    if (this.state.phase === 'open') void this.guard(retryTips(this, this.state.data));
  }

  loadMore(): void {
    if (this.state.phase === 'open') void this.guard(loadMoreLines(this, this.state.data.lines));
  }

  scope = (forRead: boolean): Scope | undefined => {
    if (this.state.phase !== 'open') return undefined;
    return {
      gen: this.gen,
      readSeq: forRead ? this.readSeq : undefined,
      signal: this.abort.signal,
      windowId: this.state.windowId,
      month: this.state.data.month,
    };
  };

  commit = (scope: Scope, action: PrivateWindowAction): boolean => {
    const state = this.state;
    if (scope.gen !== this.gen || state.phase !== 'open') return false;
    if (scope.readSeq !== undefined && scope.readSeq !== this.readSeq) return false;
    const next =
      action.type === 'touched'
        ? touchedDeadlines(state.deadlines, action.sentAt, action.remaining)
        : state.deadlines;
    if (this.dueAt(state.deadlines) || this.dueAt(next)) {
      this.close('expired');
      return false;
    }
    this.dispatch(action);
    return true;
  };

  refused = (scope: Scope, error: unknown): boolean => {
    if (scope.gen !== this.gen) return true;
    const refusal = windowRefusal(error);
    if (refusal === null) return false;
    if (refusal === 'leave') this.leave();
    else this.close(refusal);
    return true;
  };

  fail = (): void => this.close('failed');

  /** الموعد فات أو الساعتين اتفرقوا: أي واحد منهم يعني إن الموعد مبقاش يعتمد عليه. */
  private dueAt(deadlines: PrivateViewDeadlines): boolean {
    return (
      this.clock.drifted() ||
      this.deps.env.mono() >= closeAt(deadlines, this.touches.inputExpiresAt())
    );
  }

  private canOpen(epoch: number): boolean {
    const state = this.state;
    return (
      state.phase === 'pin' && state.epoch === epoch && !this.openInFlight && this.deps.env.online()
    );
  }

  /** الموعد بيتحسب كامل قبل أي نشر: لو فات بالفعل بنقفل مباشرة من غير ما نعرض الحالة المفتوحة. */
  private applyOpened(opened: PrivateViewWindow, sentAt: number): void {
    const deadlines = openedDeadlines(sentAt, opened);
    this.touches.reset(sentAt);
    if (this.dueAt(deadlines)) {
      void this.closeRemote(opened.window_id);
      return this.close('expired');
    }
    this.dispatch({ type: 'opened', windowId: opened.window_id, deadlines });
    this.armDeadline();
    this.timers.startTick();
    this.loadMonth(this.scope(true));
  }

  private openFailed(error: unknown): void {
    if (sessionEnded(error)) return this.leave();
    const wrong = error instanceof WorkHttpError && error.code === 'PIN_INVALID';
    this.close(wrong ? 'invalid' : 'failed');
  }

  /** الطلب رجع (نجح أو فشل): بيفتح الإرسال من جديد وبيشيل حالة الانتظار من غير ما يغيّر دورة النموذج. */
  private settleOpen(): void {
    this.openInFlight = false;
    this.dispatch({ type: 'settled' });
  }

  /**
   * القفل: جيل جديد، حاوية مخفية، ذاكرة، طلبات، مؤقتات، ثم خطوة الـ PIN، ثم إغلاق السيرفر بأفضل جهد.
   * دورة النموذج بتتغيّر مع أي إغلاق (حتى وإحنا في خطوة الـ PIN)، فالحقل بيتفرّغ؛ إلا فشل المحاولة نفسها وهي
   * بتفتح (PIN غلط أو فشل فتح) لأن النموذج لسه هو هو والحقل اتفرّغ لحظة الإرسال.
   */
  private close(problem: PinProblem): void {
    const previous = this.state;
    this.gen += 1;
    if (!(previous.phase === 'opening' && (problem === 'invalid' || problem === 'failed')))
      this.epoch += 1;
    this.abort.abort();
    this.abort = new AbortController();
    this.timers.clear();
    this.touches.cancel();
    this.expired.clear();
    if (this.root !== null) concealPrivateRoot(this.root);
    if (previous.phase === 'leave') return;
    this.dispatch({
      type: 'closed',
      problem: previous.phase === 'pin' ? previous.problem : problem,
      epoch: this.epoch,
      waiting: this.openInFlight,
    });
    if (previous.phase === 'open') void this.closeRemote(previous.windowId);
  }

  private closeRemote(windowId: string): Promise<void> {
    return this.deps.calls.close(windowId).catch(() => undefined);
  }

  private leave(): void {
    this.close(null);
    this.dispatch({ type: 'left' });
    this.onLeave();
  }

  /** رقم قراءة جديد بيبطل أي رد متأخر لشهر قبله، وبعدين الشهر بيتقرا من الأول. */
  private restartReads(action: PrivateWindowAction): void {
    if (this.scope(false) === undefined) return;
    this.readSeq += 1;
    this.dispatch(action);
    this.loadMonth(this.scope(true));
  }

  private loadMonth(scope: Scope | undefined): void {
    if (scope !== undefined) void this.guard(loadMonth(this, scope));
  }

  private guard(work: Promise<void>): Promise<void> {
    return work.catch(() => this.close('failed'));
  }

  private dispatch(action: PrivateWindowAction): void {
    const next = reducePrivateWindow(this.state, action);
    if (next === this.state) return;
    this.state = next;
    if (this.alive) for (const listener of this.listeners) listener();
  }

  private armDeadline(): void {
    const state = this.state;
    this.timers.arm(
      state.phase === 'open' ? closeAt(state.deadlines, this.touches.inputExpiresAt()) : undefined,
    );
  }
}
