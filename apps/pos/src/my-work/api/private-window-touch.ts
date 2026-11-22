import { TOUCH_INTERVAL_MS } from './private-window-env';
import type { WindowHost } from './private-window-host';

/**
 * لمس السيرفر بعد إدخال المستخدمة: لمسة واحدة كل 20 ثانية على الأكتر مع لمسة لاحقة واحدة.
 * الموعد بيتحرك بس لما لمسة تنجح في الجيل الحالي (commit)؛ اللمسة الفاشلة مبتمددش حاجة،
 * والخروج من الواجهة بيلغي اللمسة اللاحقة والطلب الجاري.
 */
export class TouchScheduler {
  private timer: unknown;
  private inFlight = false;
  private pending = false;
  private last = 0;

  constructor(
    private readonly host: WindowHost,
    private readonly afterTouch: () => void,
  ) {}

  /** بيبدأ من لحظة تأكيد الفتح: الفتح نفسه بيحسب كلمسة. */
  reset(openedAt: number): void {
    this.cancel();
    this.last = openedAt;
  }

  cancel(): void {
    if (this.timer !== undefined) this.host.deps.env.clearTimer(this.timer);
    this.timer = undefined;
    this.pending = false;
    this.inFlight = false;
  }

  input(): void {
    if (this.host.scope(false) === undefined) return;
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
      this.afterTouch();
    if (this.host.scope(false)?.gen !== scope.gen) return;
    this.inFlight = false;
    if (this.pending) this.schedule();
  }
}
