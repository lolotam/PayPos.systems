import type { Logger } from '@pospay/observability';

import {
  REMINDER_RECOVERY_LEASE_TTL_SECONDS,
  REMINDER_RECOVERY_RENEW_MS,
} from '../../domain/reminder-recovery.ts';
import type { ReminderRecoveryStore } from '../../ports/reminder-recovery.port.ts';

/**
 * حارس الإيجار: يجدّد المفتاح تحت فحص `pass_id` كل ثلث عمره، ويفحص معرّف تشغيل Redis
 * مع كل تجديد. فقد التجديد أو تغيّر المعرّف بينهي المسار فورًا (ADR-0061 §4 الخطوة 3).
 */
export class RecoveryLeaseKeeper {
  #lost = false;
  #timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly store: ReminderRecoveryStore,
    private readonly passId: string,
    private readonly runId: string,
    private readonly logger: Logger,
  ) {}

  /** هل فقد المسار ملكيته؟ */
  get lost(): boolean {
    return this.#lost;
  }

  /** يبدأ التجديد الدوري. */
  start(): void {
    this.#timer = setInterval(() => {
      void this.renew();
    }, REMINDER_RECOVERY_RENEW_MS);
    this.#timer.unref?.();
  }

  /** يوقف التجديد: المسار اللي وقف ما يفضلش ماسك المفتاح (ADR-0061 §4 الخطوة 3). */
  stop(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /**
   * يجدّد الإيجار مرة واحدة: التجديد لازم ينجح ومعرّف تشغيل Redis يفضل زي R0.
   *
   * @returns هل التجديد نجح
   */
  async renew(): Promise<boolean> {
    if (this.#lost) return false;
    try {
      const renewed = await this.store.renew(this.passId, REMINDER_RECOVERY_LEASE_TTL_SECONDS);
      if (!renewed) {
        this.#lost = true;
        return false;
      }
      const runId = await this.store.serverRunId();
      if (runId !== this.runId) {
        this.#lost = true;
        return false;
      }
      return true;
    } catch (error) {
      this.#lost = true;
      this.logger.warn({ err: error }, 'commission reminder recovery lease renewal failed');
      return false;
    }
  }
}
