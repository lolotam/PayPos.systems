import { IDLE_LIMIT_MS, TOUCH_INTERVAL_MS } from './private-window-env';
import type { WindowHost } from './private-window-host';

/**
 * لمس السيرفر بعد إدخال المستخدمة: لمسة واحدة كل 20 ثانية على الأكتر مع لمسة لاحقة واحدة.
 * موعد السيرفر بيتحرك بس لما لمسة تنجح في الجيل الحالي (commit)؛ اللمسة الفاشلة مبتمددش حاجة،
 * والخروج من الواجهة بيلغي اللمسة اللاحقة والطلب الجاري.
 * وبيفتكر آخر إدخال فعلي لوحده: اللمسة المتأجلة بتتبعت متأخرة ورد السيرفر بيحسب الخمول من إرسالها،
 * فموعد الخمول المحلي بيتحسب من الإدخال نفسه (`inputExpiresAt`) عشان التأجيل ميمدّش عرض البيانات عن الـ 60 ثانية.
 */
export class TouchScheduler {
  private timer: unknown;
  private inFlight = false;
  private pending = false;
  private last = 0;
  private lastInput = 0;

  constructor(
    private readonly host: WindowHost,
    private readonly onDeadlineChange: () => void,
  ) {}

  /** بيبدأ من لحظة إرسال الفتح: الفتح نفسه بيحسب كلمسة وكإدخال. */
  reset(openedAt: number): void {
    this.cancel();
    this.last = openedAt;
    this.lastInput = openedAt;
  }

  /** @returns اللحظة الرتيبة اللي الشاشة لازم تتقفل فيها لو مفيش إدخال بعد آخر واحد */
  inputExpiresAt(): number {
    return this.lastInput + IDLE_LIMIT_MS;
  }

  cancel(): void {
    if (this.timer !== undefined) this.host.deps.env.clearTimer(this.timer);
    this.timer = undefined;
    this.pending = false;
    this.inFlight = false;
  }

  /** إدخال جوّا الشاشة: بيحرّك موعد الخمول المحلي، وبيطلب لمسة (إلا لو الموعد فات فعلاً: الإدخال ده مبيرجّعش شاشة اتقفلت). */
  input(): void {
    const now = this.host.deps.env.mono();
    if (this.host.scope(false) === undefined || now >= this.inputExpiresAt()) return;
    this.lastInput = now;
    this.onDeadlineChange();
    this.pending = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.timer !== undefined || this.inFlight) return;
    const { env } = this.host.deps;
    const wait = Math.max(0, this.last + TOUCH_INTERVAL_MS - env.mono());
    if (wait === 0) this.run();
    else
      this.timer = env.setTimer(() => {
        this.timer = undefined;
        this.run();
      }, wait);
  }

  private run(): void {
    this.send().catch(() => this.host.fail());
  }

  private async send(): Promise<void> {
    const scope = this.host.scope(false);
    if (scope === undefined) return;
    const { env, calls } = this.host.deps;
    this.pending = false;
    this.inFlight = true;
    const sentAt = env.mono();
    this.last = sentAt;
    const remaining = await calls.touch(scope.windowId, scope.signal).catch((error: unknown) => {
      this.host.refused(scope, error);
      return undefined;
    });
    if (remaining && this.host.commit(scope, { type: 'touched', sentAt, remaining }))
      this.onDeadlineChange();
    if (this.host.scope(false)?.gen !== scope.gen) return;
    this.inFlight = false;
    if (this.pending) this.schedule();
  }
}
