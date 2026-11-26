import { type PrivateViewEnv, TICK_MS } from './env';

/**
 * مؤقتين للنافذة المفتوحة: مؤقت الموعد نفسه (بيقفل في لحظته بالظبط)، وفحص كل ثانية بيمسك أي موعد فات أو نوم
 * لو المؤقت الأول اتأخر. التاني مبيعتمدش على الأول، فكل واحد ليه اختبار مستقل.
 */
export class WindowTimers {
  private deadline: unknown;
  private tick: unknown;

  /**
   * @param env الساعات والمؤقتات
   * @param isDue هل الموعد فات أو الساعة اتحرّكت (فحص كل ثانية)
   * @param onDue بتتنده لما المؤقت أو الفحص يلاقي إن النافذة لازم تتقفل
   */
  constructor(
    private readonly env: PrivateViewEnv,
    private readonly isDue: () => boolean,
    private readonly onDue: () => void,
  ) {}

  /** بيضبط مؤقت الموعد على اللحظة الرتيبة دي (أو بيلغيه لو undefined). */
  arm(at: number | undefined): void {
    if (this.deadline !== undefined) this.env.clearTimer(this.deadline);
    this.deadline = undefined;
    if (at === undefined) return;
    this.deadline = this.env.setTimer(this.onDue, Math.max(0, at - this.env.mono()));
  }

  startTick(): void {
    this.tick = this.env.setTimer(() => this.check(), TICK_MS);
  }

  clear(): void {
    for (const timer of [this.deadline, this.tick])
      if (timer !== undefined) this.env.clearTimer(timer);
    this.deadline = undefined;
    this.tick = undefined;
  }

  private check(): void {
    if (this.isDue()) return this.onDue();
    this.tick = this.env.setTimer(() => this.check(), TICK_MS);
  }
}
