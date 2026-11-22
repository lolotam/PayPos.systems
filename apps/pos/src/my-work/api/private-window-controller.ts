import { closeAt, openedDeadlines } from '../model/private-view-deadline';
import {
  type PinProblem,
  type PrivateWindowAction,
  type PrivateWindowState,
  reducePrivateWindow,
} from '../model/private-window-state';
import { WorkHttpError, sessionEnded, windowExpired } from '../model/work-error';
import { CLOCK_DRIFT_MS, type PrivateWindowDeps, TICK_MS } from './private-window-env';
import type { Scope, WindowHost } from './private-window-host';
import { attachWindowListeners } from './private-window-listeners';
import { loadLines, loadTips } from './private-window-reads';
import { TouchScheduler } from './private-window-touch';

/**
 * متحكم النافذة الخاصة على جهاز الاستقبال. القاعدة الوحيدة: أي خروج من الواجهة يقفل النافذة ويطلب الرقم السري.
 * (إخفاء، pagehide، freeze، resume، pageshow راجعة، blur، فك التركيب، تغيّر المشغّلة، موعد القفل،
 * رفض أو انتهاء من السيرفر، أو أي خطأ جوّاه): كل ده `close` بيرفع الجيل ويمسح الذاكرة فوراً
 * ويلغي الطلبات والمؤقتات ويرجع لخطوة الـ PIN ويبعت إغلاق للسيرفر بأفضل جهد. أي رد بيوصل بجيل قديم
 * بيترمي (ورد الفتح القديم بيتقفل في السيرفر برقمه ومبيتعرضش)، وأي رد بيتطبّق بس لو الجيل هو
 * الحالي والموعد المؤكَّد ما فاتش وقت التطبيق. مفيش تخزين ولا كاش ولا تابات مشتركة.
 */
export class PrivateWindowController implements WindowHost {
  private gen = 0;
  private readSeq = 0;
  private abort = new AbortController();
  private alive = false;
  private state: PrivateWindowState = { phase: 'pin', problem: null };
  private readonly listeners = new Set<() => void>();
  private deadlineTimer: unknown;
  private tickTimer: unknown;
  private tickBase = { mono: 0, wall: 0 };
  private readonly touches: TouchScheduler;

  constructor(
    readonly deps: PrivateWindowDeps,
    private readonly onLeave: () => void,
  ) {
    this.touches = new TouchScheduler(this, () => this.armDeadline());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): PrivateWindowState => this.state;

  /** بيركّب المستمعين من أول mount؛ والدالة المرجعة بتقفل وتشيل كل حاجة (فك التركيب). */
  start(): () => void {
    this.alive = true;
    const detach = attachWindowListeners(
      () => this.close('expired'),
      () => this.touches.input(),
    );
    return () => {
      this.close(null);
      this.alive = false;
      detach();
    };
  }

  /** الحالة اللي الشاشة تعرضها: النافذة المفتوحة بعد موعدها (والمؤقت لسه ما اشتغلش) مبتتعرضش. */
  visible(state: PrivateWindowState): PrivateWindowState {
    if (state.phase === 'open' && this.deps.env.mono() >= closeAt(state.deadlines))
      return { phase: 'pin', problem: 'expired' };
    return state;
  }

  /** فتح النافذة بالـ PIN؛ الرد بيتطبّق بس لو الجيل لسه هو اللي بدأ. */
  async submitPin(pin: string): Promise<void> {
    const { env, calls } = this.deps;
    if (this.state.phase !== 'pin' || !env.online()) return;
    const gen = this.gen;
    const sentAt = env.mono();
    this.dispatch({ type: 'opening' });
    try {
      const opened = await calls.open(pin);
      if (gen !== this.gen) return void calls.close(opened.window_id);
      const deadlines = openedDeadlines(sentAt, opened);
      if (closeAt(deadlines) <= env.mono()) {
        void calls.close(opened.window_id);
        return this.close('expired');
      }
      this.dispatch({ type: 'opened', windowId: opened.window_id, deadlines });
      this.touches.reset(sentAt);
      this.armDeadline();
      this.startTick();
      this.loadMonth(this.scope(true));
    } catch (error) {
      if (gen !== this.gen) return;
      if (sessionEnded(error)) return this.leave();
      const wrong = error instanceof WorkHttpError && error.code === 'PIN_INVALID';
      this.close(wrong ? 'invalid' : 'failed');
    }
  }

  stepMonth(month: string): void {
    if (this.scope(false) === undefined) return;
    this.readSeq += 1;
    this.dispatch({ type: 'month', month });
    this.loadMonth(this.scope(true));
  }

  retry(): void {
    if (this.scope(false) === undefined) return;
    this.readSeq += 1;
    this.dispatch({ type: 'retry' });
    this.loadMonth(this.scope(true));
  }

  loadMore(): void {
    const scope = this.scope(true);
    const lines = this.state.phase === 'open' ? this.state.data.lines : undefined;
    const cursor = lines?.pages.at(-1)?.next_cursor;
    if (scope === undefined || !cursor || lines?.fetchingMore) return;
    this.dispatch({ type: 'linesMore' });
    void this.guard(loadLines(this, scope, cursor));
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
    if (this.deps.env.mono() >= closeAt(state.deadlines)) {
      this.close('expired');
      return false;
    }
    this.dispatch(action);
    return true;
  };

  refused = (scope: Scope, error: unknown): boolean => {
    if (scope.gen !== this.gen) return true;
    if (windowExpired(error)) this.close('expired');
    else if (sessionEnded(error)) this.leave();
    else return false;
    return true;
  };

  fail = (): void => this.close('failed');

  /** القفل: ذاكرة، طلبات، مؤقتات، ثم خطوة الـ PIN، ثم إغلاق السيرفر بأفضل جهد. */
  private close(problem: PinProblem): void {
    this.gen += 1;
    this.abort.abort();
    this.abort = new AbortController();
    this.clearTimers();
    const previous = this.state;
    if (previous.phase === 'open' || previous.phase === 'opening')
      this.dispatch({ type: 'closed', problem });
    if (previous.phase === 'open') void this.deps.calls.close(previous.windowId);
  }

  private leave(): void {
    this.close(null);
    this.dispatch({ type: 'left' });
    this.onLeave();
  }

  private loadMonth(scope: Scope | undefined): void {
    if (scope === undefined) return;
    void this.guard(loadLines(this, scope, undefined));
    void this.guard(loadTips(this, scope));
  }

  private guard(work: Promise<void>): Promise<void> {
    return work.catch(() => this.close('failed'));
  }

  private dispatch(action: PrivateWindowAction): void {
    this.state = reducePrivateWindow(this.state, action);
    if (this.alive) for (const listener of this.listeners) listener();
  }

  private armDeadline(): void {
    const { env } = this.deps;
    if (this.deadlineTimer !== undefined) env.clearTimer(this.deadlineTimer);
    this.deadlineTimer = undefined;
    if (this.state.phase !== 'open') return;
    const wait = Math.max(0, closeAt(this.state.deadlines) - env.mono());
    this.deadlineTimer = env.setTimer(() => this.close('expired'), wait);
  }

  private startTick(): void {
    const { env } = this.deps;
    this.tickBase = { mono: env.mono(), wall: env.wall() };
    this.tickTimer = env.setTimer(() => this.tick(), TICK_MS);
  }

  /** كل ثانية: الساعة الجدارية اتحرّكت غير الرتيبة (نوم أو تغيير ساعة)، أو الموعد فات، يبقى قفل. */
  private tick(): void {
    const { env } = this.deps;
    const state = this.state;
    if (state.phase !== 'open') return;
    const mono = env.mono();
    const wall = env.wall();
    const drift = Math.abs(wall - this.tickBase.wall - (mono - this.tickBase.mono));
    if (drift > CLOCK_DRIFT_MS || mono >= closeAt(state.deadlines)) return this.close('expired');
    this.tickBase = { mono, wall };
    this.tickTimer = env.setTimer(() => this.tick(), TICK_MS);
  }

  private clearTimers(): void {
    const { env } = this.deps;
    for (const timer of [this.deadlineTimer, this.tickTimer])
      if (timer !== undefined) env.clearTimer(timer);
    this.deadlineTimer = undefined;
    this.tickTimer = undefined;
    this.touches.cancel();
  }
}
