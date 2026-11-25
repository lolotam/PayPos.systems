import {
  REMINDER_RECOVERY_MAX_IDLE_MS,
  REMINDER_RECOVERY_PASS_DEADLINE_MS,
} from '../../domain/reminder-recovery.ts';
import type { RecoverCommissionRemindersDeps } from './recovery-types.ts';

/** سبب توقف عملية: تعدّت مهلتها أو فترة التوقّف المسموحة بلا تقدّم. */
export class RecoveryStalled extends Error {
  constructor(readonly operation: string) {
    super(`commission reminder recovery operation stalled: ${operation}`);
  }
}

/** تقدّم المسار: آخر لحظة تقدّم واللحظة الصلبة لنهاية المسار. */
export interface RecoveryProgress {
  lastAt: number;
  readonly hardDeadlineAt: number;
}

/**
 * يبدأ تتبّع التقدّم من لحظة بدء المسار مع المهلة الصلبة الكلية.
 *
 * @param deps الساعة
 * @returns حالة التقدّم الابتدائية
 */
export function createProgress(deps: RecoverCommissionRemindersDeps): RecoveryProgress {
  const startedAt = deps.clock.now().getTime();
  return {
    lastAt: startedAt,
    hardDeadlineAt: startedAt + REMINDER_RECOVERY_PASS_DEADLINE_MS,
  };
}

/**
 * يحدّث آخر لحظة تقدّم بعد إتمام عملية.
 *
 * @param deps     الساعة
 * @param progress حالة التقدّم
 */
export function touchProgress(
  deps: RecoverCommissionRemindersDeps,
  progress: RecoveryProgress,
): void {
  progress.lastAt = deps.clock.now().getTime();
}

/**
 * يشغّل عملية بمهلة: لو عدّت المهلة (أو فضل أقل من الفترة المسموحة بلا تقدّم أو عدّت المهلة
 * الصلبة) بيرمي توقّف بدل ما يستنى للأبد.
 *
 * @param deps      الساعة والمهل
 * @param progress  تقدّم المسار
 * @param operation اسم العملية للتشخيص
 * @param limitMs   مهلة العملية
 * @param run       العملية نفسها
 * @returns نتيجة العملية
 */
export async function bounded<T>(
  deps: RecoverCommissionRemindersDeps,
  progress: RecoveryProgress,
  operation: string,
  limitMs: number,
  run: () => Promise<T>,
): Promise<T> {
  const maxIdle = deps.maxIdleMs ?? REMINDER_RECOVERY_MAX_IDLE_MS;
  const nowMs = deps.clock.now().getTime();
  const idleLeft = maxIdle - (nowMs - progress.lastAt);
  const hardLeft = progress.hardDeadlineAt - nowMs;
  const allowed = Math.min(limitMs, idleLeft, hardLeft);
  if (allowed <= 0) throw new RecoveryStalled(operation);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RecoveryStalled(operation)), allowed);
  });
  try {
    return await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
