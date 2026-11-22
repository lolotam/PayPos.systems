/*
 * الثابت الوحيد اللي الساعة دي بتفرضه (ADR-0019 addendum 2026-10-21، البند 6 و7):
 *
 * صفوف العرض الخاص ما بتتنشرش في الكاش ولا بتتعرض إلا لما التلاتة دول يتحققوا مع بعض:
 *   (1) المفتاح المشترك مقروء ويسمّي رقم نافذة التاب ده.
 *   (2) موعد الخمول اللي أكّده السيرفر والسقف المطلق لسه ما عدّوش.
 *   (3) التاب «متحقَّق منه في دورة ظهوره الحالية»: من آخر حد إخفاء أو pagehide أو freeze أو صحيان
 *       غير مضمون، لازم لمسة اتبعتت بعد الحد ده تكون نجحت.
 * أي حاجة غير كده (مفتاح مش مقروء، مفقود، لنافذة تانية، موعد عدّى، دورة مش متحقَّق منها، أو أي
 * استثناء وقت الفحص) = إخفاء ومسح كاش، ولو النافذة راحت = خطوة الـ PIN. كل فحص بيفشل مغلقاً.
 * مفيش قاعدة وقت: مفيش فاصل ولا دمج بالزمن. أحداث نفس الدورة (visibilitychange وfocus وpageshow
 * اللي بتيجي مع بعض) بتتشارك لمسة واحدة، وكل دورة جديدة لازم لمسة جديدة بتتبعت بعد حدّها.
 */
import {
  closeAt,
  touchedDeadlines,
  type PrivateViewDeadlines,
  type PrivateViewRemaining,
} from '../model/private-view-deadline';
import {
  extendSharedKey,
  observeWindowSignals,
  readSharedKey,
  wallStatus,
} from '../model/private-view-key';
import { sessionEnded, windowExpired } from '../model/work-error';
import { privateViewCalls } from './private-view-calls';
import {
  type ClockEnv,
  type ClockHandlers,
  type CloseScope,
  type ConfirmedWindow,
  type PrivateViewClockHandle,
  PRIVATE_VIEW_TICK_MS,
  PRIVATE_VIEW_TOUCH_MS,
  monotonicNow,
  wallNow,
} from './private-view-clock-types';

export * from './private-view-clock-types';

const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;
const realEnv: ClockEnv = { mono: monotonicNow, wall: wallNow };

/**
 * ساعة النافذة المفتوحة على جهاز الاستقبال. الشاشة بتتقفل في الأبكر بين موعد الخمول المؤكَّد من
 * السيرفر والسقف المطلق، وبتتفحص على نبضة دورية وعلى `visibilitychange` و`focus` و`pageshow`.
 * الإدخال بيطلب لمسة (مرة كل 20 ثانية على الأكتر) ومبيمددش بنفسه.
 */
class PrivateViewClock {
  private deadlines: PrivateViewDeadlines;
  private sentWall: number;
  private lastTouch: number;
  private done = false;
  /** رقم دورة الظهور؛ كل حد (إخفاء، pagehide، freeze، صحيان غير مضمون) بيزوده. */
  private cycle = 0;
  /** الدورة الحالية اتحقق منها بلمسة اتبعتت بعد حدّها (الفتح بالـ PIN بيحقق الدورة صفر). */
  private verified = true;
  /** رقم الدورة اللي لمسة تحقق ليها في الطريق، عشان أحداث نفس الدورة تتشارك لمسة. */
  private verifying: number | undefined;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private trailing: ReturnType<typeof setTimeout> | undefined;
  private tick: ReturnType<typeof setInterval> | undefined;
  private stopSignals: (() => void) | undefined;

  constructor(
    private readonly opened: ConfirmedWindow,
    private readonly handlers: ClockHandlers,
    private readonly env: ClockEnv,
  ) {
    this.deadlines = opened.deadlines;
    this.sentWall = opened.sentWall;
    this.lastTouch = env.mono();
  }

  start(): PrivateViewClockHandle {
    this.arm();
    this.tick = setInterval(this.check, PRIVATE_VIEW_TICK_MS);
    // إشارات القفل (القناة والتخزين) بتتتابع دايماً: أحدث نافذة لازم توصل لأقدم تاب.
    this.stopSignals = observeWindowSignals(this.opened.windowId, () => this.end('self'));
    for (const event of INPUT_EVENTS)
      document.addEventListener(event, this.input, { capture: true, passive: true });
    document.addEventListener('visibilitychange', this.visibility);
    document.addEventListener('freeze', this.boundary);
    document.addEventListener('resume', this.untrusted);
    window.addEventListener('focus', this.untrusted);
    window.addEventListener('pageshow', this.pageshow);
    window.addEventListener('pagehide', this.boundary);
    return {
      stop: this.dispose,
      epoch: () => this.cycle,
      fence: this.fence,
      isCurrent: this.isCurrent,
    };
  }

  private readonly dispose = () => {
    this.done = true;
    clearTimeout(this.expiry);
    clearTimeout(this.trailing);
    clearInterval(this.tick);
    this.stopSignals?.();
    for (const event of INPUT_EVENTS) document.removeEventListener(event, this.input, true);
    document.removeEventListener('visibilitychange', this.visibility);
    document.removeEventListener('freeze', this.boundary);
    document.removeEventListener('resume', this.untrusted);
    window.removeEventListener('focus', this.untrusted);
    window.removeEventListener('pageshow', this.pageshow);
    window.removeEventListener('pagehide', this.boundary);
  };

  private end(scope: CloseScope) {
    if (this.done) return;
    this.dispose();
    this.handlers.close(scope);
  }

  private arm() {
    clearTimeout(this.expiry);
    const wait = Math.max(0, closeAt(this.deadlines) - this.env.mono());
    this.expiry = setTimeout(() => this.end('all'), wait);
  }

  /**
   * بيطبّق الشرطين (1) و(2) من غير أي أثر جانبي: المواعيد الرتيبة، وبعدين الساعة الجدارية (أقدم من
   * لحظة الإرسال معناها إنها اتحركت لورا)، وبعدين المفتاح المشترك. مفتاح مش مقروء أو مفقود أو
   * لنافذة تانية = `self`؛ موعده خلص أو بعيد زيادة = `all`. أي استثناء = `self`. null = النافذة
   * الحالية. الدورة (الشرط 3) بتتفحص في `fence` و`isCurrent` و`accepted`.
   */
  private status(): CloseScope | null {
    try {
      const wall = this.env.wall();
      if (closeAt(this.deadlines) <= this.env.mono() || wall < this.sentWall) return 'all';
      const key = readSharedKey();
      if (key === 'unavailable' || key === null || key.windowId !== this.opened.windowId)
        return 'self';
      return wallStatus(key, wall) === 'live' ? null : 'all';
    } catch {
      return 'self';
    }
  }

  /** بينفّذ `status`: بيقفل التاب لو لازم، وبيرجّع true لو التاب اتقفل. */
  private readonly check = (): boolean => {
    if (this.done) return true;
    const scope = this.status();
    if (scope !== null) this.end(scope);
    return this.done;
  };

  /**
   * سياج الرد: رد قراءة ناجح ما بيتنشر إلا لو نافذته هي الحالية (شرط 1 و2 من غير انتظار إشارة
   * التخزين)، والتاب متحقَّق منه (شرط 3)، ودورة الطلب هي الحالية. بيقفل التاب لو (1) أو (2) فشلوا.
   */
  private readonly fence = (windowId: string, epoch: number): boolean =>
    windowId === this.opened.windowId && !this.check() && this.verified && epoch === this.cycle;

  private readonly isCurrent = (windowId: string): boolean =>
    windowId === this.opened.windowId && !this.done && this.status() === null && this.verified;

  /** حد دورة: إخفاء، pagehide، freeze، أو صحيان غير مضمون. الشاشة تتخفي والدورة الجديدة لازم لمسة. */
  private readonly boundary = () => {
    if (this.done) return;
    this.cycle += 1;
    this.verified = false;
    // لمسة الإدخال المؤجلة بتتلغي: مبتتبعتش بعد الحد من غير ما تعدّي على التحقق.
    clearTimeout(this.trailing);
    this.trailing = undefined;
    this.handlers.hide();
  };

  private readonly visibility = () => {
    if (document.visibilityState === 'hidden') this.boundary();
    else if (this.verified) this.check();
    else this.verify();
  };

  /** تركيز أو resume أو رجوع من bfcache: وقته مش مضمون (الصحيان ممكن يوصل بتركيز لوحده). */
  private readonly untrusted = () => {
    if (this.check()) return;
    if (this.verified) this.boundary();
    this.verify();
  };

  private readonly pageshow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) this.untrusted();
    else this.check();
  };

  /**
   * بيبعت لمسة التحقق للدورة الحالية لو مفيش واحدة لنفس الدورة في الطريق. من غير أي قاعدة وقت:
   * لمسة دورة قديمة (قبل حد النوم مثلاً) مبتحققش دورة جديدة، فبتتبعت لمسة جديدة.
   */
  private verify() {
    if (this.check()) return;
    if (document.visibilityState === 'hidden' || this.verifying === this.cycle) return;
    this.verifying = this.cycle;
    this.send();
  }

  private readonly input = () => {
    if (!this.verified) return;
    const wait = this.lastTouch + PRIVATE_VIEW_TOUCH_MS - this.env.mono();
    if (wait <= 0) this.send();
    else this.trailing ??= setTimeout(() => this.send(), wait);
  };

  private send() {
    if (this.done) return;
    // لمسة الإدخال المؤجلة بتتلغي هنا؛ لو اتسابت شغالة كانت هتبعت تاني خلال 20 ثانية أو بعد الإيقاف.
    clearTimeout(this.trailing);
    this.trailing = undefined;
    const cycle = this.cycle;
    const sentAt = this.env.mono();
    const sentWall = this.env.wall();
    this.lastTouch = sentAt;
    let call: Promise<PrivateViewRemaining>;
    try {
      call = privateViewCalls.touch(this.opened.windowId);
    } catch (error) {
      call = Promise.reject(error);
    }
    call.then(
      (remaining) => {
        if (!this.done) this.accepted(cycle, sentAt, sentWall, remaining);
      },
      (error: unknown) => {
        if (!this.done) this.rejected(cycle, error);
      },
    );
  }

  /** لمسة نجحت: المواعيد بتتحدّث دايماً، والتحقق بيتسجل بس لو اللمسة اتبعتت في الدورة الحالية. */
  private accepted(
    cycle: number,
    sentAt: number,
    sentWall: number,
    remaining: PrivateViewRemaining,
  ) {
    if (!this.confirm(sentAt, sentWall, remaining)) return;
    if (cycle !== this.cycle || this.verified) return;
    if (this.check()) return;
    this.verified = true;
    this.verifying = undefined;
    this.handlers.show();
  }

  /** لمسة فشلت: رفض السيرفر قاطع، وأي فشل تاني في دورة مش متحقَّق منها بيقفل التاب بس. */
  private rejected(cycle: number, error: unknown) {
    if (windowExpired(error) || sessionEnded(error)) this.handlers.refused(error);
    else if (cycle === this.cycle && !this.verified) this.end('self');
  }

  private confirm(sentAt: number, sentWall: number, remaining: PrivateViewRemaining): boolean {
    this.deadlines = touchedDeadlines(this.deadlines, sentAt, remaining);
    this.sentWall = Math.max(this.sentWall, sentWall);
    try {
      const idle = sentWall + remaining.idle_remaining_ms;
      const cap = sentWall + remaining.cap_remaining_ms;
      if (extendSharedKey(this.opened.windowId, idle, cap) !== 'updated') throw new Error('key');
    } catch {
      this.end('self');
      return false;
    }
    this.arm();
    return true;
  }
}

/**
 * بيشغّل ساعة نافذة مفتوحة.
 *
 * @param confirmed النافذة المفتوحة ومواعيدها
 * @param handlers ردود الفعل: إخفاء، إظهار، قفل بنطاقه، ورفض السيرفر
 * @param env الساعتين (للاختبار)
 * @returns الإيقاف ورقم الدورة وسياج النافذة الحالية
 */
export function startPrivateViewClock(
  confirmed: ConfirmedWindow,
  handlers: ClockHandlers,
  env: ClockEnv = realEnv,
): PrivateViewClockHandle {
  return new PrivateViewClock(confirmed, handlers, env).start();
}
