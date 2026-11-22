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

/** أقل فاصل بين لمستين للسيرفر. */
export const PRIVATE_VIEW_TOUCH_MS = 20_000;
/** فاصل الفحص الدوري للمواعيد الجدارية والمفتاح المشترك. */
export const PRIVATE_VIEW_TICK_MS = 5_000;
/** حدث رجوع (ظهور/تركيز/bfcache) بعد تحقق بدأ من أقل من كده ما بيطلبش لمسة تانية. */
export const PRIVATE_VIEW_VERIFY_COALESCE_MS = 1_000;
const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'] as const;

/** الساعة الرتيبة للتاب: المصدر الوحيد للوقت في النافذة، والاختبارات بتتحكم فيها بالمؤقتات المزيفة. */
export const monotonicNow = (): number => performance.now();
/** الساعة الجدارية المشتركة بين التابات، للمفتاح المشترك وفحص ساعة الجهاز بس. */
export const wallNow = (): number => Date.now();

/**
 * نافذة مفتوحة ومواعيدها اللي أكّدها السيرفر في رد الفتح.
 * `sentWall` الساعة الجدارية لحظة إرسال آخر طلب نجح (في الذاكرة بس)؛ و`shared` معناها إن المفتاح
 * المشترك اتكتب وإن التاب بيتابعه.
 */
export type ConfirmedWindow = {
  windowId: string;
  deadlines: PrivateViewDeadlines;
  sentWall: number;
  shared: boolean;
};

/**
 * `all`: النافذة خلصت لكل التابات (قفل في السيرفر ومسح المفتاح وبلاغ). `self`: خلصت من برّه
 * (تاب تاني قفلها أو نافذة أحدث خدت مكانها) فالتاب بيمسح نفسه بس.
 */
export type CloseScope = 'all' | 'self';

export type ClockHandlers = {
  /** إخفاء الشاشة ومسح كاشها لحد ما لمسة تتأكد. */
  hide: () => void;
  /** اللمسة نجحت: الشاشة ترجع. */
  show: () => void;
  close: (scope: CloseScope) => void;
  /** رفض السيرفر للمسة (النافذة أو الجلسة خلصت). */
  refused: (error: unknown) => void;
};

export type ClockEnv = { mono: () => number; wall: () => number };

/** اللي الساعة بتديه للشاشة: الإيقاف، وسياج النافذة الحالية قبل أي نشر أو عرض. */
export type PrivateViewClockHandle = {
  stop: () => void;
  /** بيفحص ويقفل التاب لو النافذة مش الحالية؛ false = ارمي الرد. */
  fence: (windowId: string) => boolean;
  /** نفس الفحص من غير ما يقفل حاجة، لمنع العرض أثناء الرسم. */
  isCurrent: (windowId: string) => boolean;
};

const realEnv: ClockEnv = { mono: monotonicNow, wall: wallNow };

/**
 * ساعة النافذة المفتوحة على جهاز الاستقبال. الشاشة بتتقفل في الأبكر بين موعد الخمول المؤكَّد من
 * السيرفر والسقف المطلق، وبتتفحص كمان على نبضة دورية وعلى `visibilitychange` و`focus` و`pageshow`
 * ضد المواعيد الرتيبة والمفتاح المشترك. تاب رجع ظاهر بعد ما كان مخفي، أو أخد تركيز، أو رجع من الـ bfcache،
 * مبيعرضش حاجة قبل ما لمسة تنجح (الصحيان ممكن يوصل بتركيز لوحده)، والأحداث المتداخلة بتبعت لمسة واحدة.
 * الإدخال بيطلب لمسة (مرة كل 20 ثانية على الأكتر) ومبيمددش بنفسه.
 */
class PrivateViewClock {
  private deadlines: PrivateViewDeadlines;
  private sentWall: number;
  private lastTouch: number;
  private done = false;
  private wasHidden = false;
  private verifying = false;
  private lastVerifyAt = Number.NEGATIVE_INFINITY;
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
    // إشارات القفل (القناة والتخزين) بتتتابع دايماً، حتى لو كتابة المفتاح فشلت: أحدث نافذة لازم توصل لأقدم تاب.
    this.stopSignals = observeWindowSignals(this.opened.windowId, () => this.end('self'));
    for (const event of INPUT_EVENTS)
      document.addEventListener(event, this.input, { capture: true, passive: true });
    document.addEventListener('visibilitychange', this.visibility);
    window.addEventListener('focus', this.focus);
    window.addEventListener('pageshow', this.pageshow);
    return { stop: this.dispose, fence: this.fence, isCurrent: this.isCurrent };
  }

  private readonly dispose = () => {
    this.done = true;
    clearTimeout(this.expiry);
    clearTimeout(this.trailing);
    clearInterval(this.tick);
    this.stopSignals?.();
    for (const event of INPUT_EVENTS) document.removeEventListener(event, this.input, true);
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('focus', this.focus);
    window.removeEventListener('pageshow', this.pageshow);
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
   * بيقارن مواعيد التاب: الرتيبة أولاً، وبعدين الساعة الجدارية (أقدم من لحظة الإرسال معناها إنها
   * اتحركت لورا)، وبعدين المفتاح المشترك (مفقود أو لنافذة تانية = ما بينّاش، وموعده خلص أو بعيد
   * زيادة = قفل للكل). بيرجّع نطاق القفل المطلوب، أو null لو النافذة لسه الحالية. من غير أي أثر جانبي.
   */
  private status(): CloseScope | null {
    const wall = this.env.wall();
    if (closeAt(this.deadlines) <= this.env.mono() || wall < this.sentWall) return 'all';
    if (!this.opened.shared) return null;
    const key = readSharedKey();
    if (key === 'unavailable') return null;
    if (key === null || key.windowId !== this.opened.windowId) return 'self';
    return wallStatus(key, wall) === 'live' ? null : 'all';
  }

  /** بينفّذ `status`: بيقفل التاب لو لازم، وبيرجّع true لو التاب اتقفل. */
  private readonly check = (): boolean => {
    if (this.done) return true;
    const scope = this.status();
    if (scope !== null) this.end(scope);
    return this.done;
  };

  /**
   * سياج الرد: رد قراءة ناجح ما بيتنشر ولا بيتعرض إلا لو نافذته هي الحالية دلوقتي (المفتاح المشترك
   * والمواعيد المؤكَّدة)، من غير انتظار إشارة التخزين اللي ممكن توصل بعد الرد (ADR-0019 البند 6).
   */
  private readonly fence = (windowId: string): boolean =>
    windowId === this.opened.windowId && !this.check();

  private readonly isCurrent = (windowId: string): boolean =>
    windowId === this.opened.windowId && !this.done && this.status() === null;

  private readonly visibility = () => {
    if (document.visibilityState === 'hidden') {
      this.wasHidden = true;
      return;
    }
    if (!this.wasHidden) {
      this.check();
      return;
    }
    this.wasHidden = false;
    this.untrusted();
  };

  private readonly focus = () => this.untrusted();

  private readonly pageshow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) this.untrusted();
    else this.check();
  };

  /**
   * رجوع وقته مش مضمون (ظهور بعد إخفاء، تركيز، bfcache): بعد الصحيان ممكن الساعة الرتيبة تكون واقفة
   * والجدارية متراجعة جزئياً فالاتنين يبانوا سليمين والسيرفر قفل، فمفيش حدث منهم بيتصدّق لوحده.
   * `visibilitychange` و`focus` و`pageshow` المتداخلة بتبعت لمسة واحدة (`verifying` وفاصل قصير).
   */
  private untrusted() {
    if (this.check()) return;
    if (this.env.mono() - this.lastVerifyAt < PRIVATE_VIEW_VERIFY_COALESCE_MS) return;
    this.verify();
  }

  /** سياق وقته مش مضمون: الشاشة تتخفي وكاشها يتمسح، ومتظهرش تاني إلا بعد لمسة ناجحة. */
  private verify() {
    if (this.verifying) return;
    this.verifying = true;
    this.lastVerifyAt = this.env.mono();
    this.handlers.hide();
    this.send(() => {
      this.verifying = false;
      this.handlers.show();
    });
  }

  private readonly input = () => {
    if (this.verifying) return;
    const wait = this.lastTouch + PRIVATE_VIEW_TOUCH_MS - this.env.mono();
    if (wait <= 0) this.send();
    else this.trailing ??= setTimeout(() => this.send(), wait);
  };

  private send(onPass?: () => void) {
    if (this.done) return;
    // لمسة الإدخال المؤجلة بتتلغي هنا؛ لو اتسابت شغالة كانت هتبعت تاني خلال 20 ثانية أو بعد الإيقاف.
    clearTimeout(this.trailing);
    this.trailing = undefined;
    const sentAt = this.env.mono();
    const sentWall = this.env.wall();
    this.lastTouch = sentAt;
    privateViewCalls.touch(this.opened.windowId).then(
      (remaining) => {
        if (!this.done && this.confirm(sentAt, sentWall, remaining)) onPass?.();
      },
      (error: unknown) => {
        if (this.done) return;
        if (windowExpired(error) || sessionEnded(error)) this.handlers.refused(error);
        else if (onPass) this.end('self');
      },
    );
  }

  private confirm(sentAt: number, sentWall: number, remaining: PrivateViewRemaining): boolean {
    this.deadlines = touchedDeadlines(this.deadlines, sentAt, remaining);
    this.sentWall = Math.max(this.sentWall, sentWall);
    if (this.opened.shared) {
      const idle = sentWall + remaining.idle_remaining_ms;
      const cap = sentWall + remaining.cap_remaining_ms;
      if (extendSharedKey(this.opened.windowId, idle, cap) === 'mismatch') {
        this.end('self');
        return false;
      }
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
 * @returns الإيقاف وسياج النافذة الحالية
 */
export function startPrivateViewClock(
  confirmed: ConfirmedWindow,
  handlers: ClockHandlers,
  env: ClockEnv = realEnv,
): PrivateViewClockHandle {
  return new PrivateViewClock(confirmed, handlers, env).start();
}
