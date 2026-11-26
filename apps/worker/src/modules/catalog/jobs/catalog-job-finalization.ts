import { UnrecoverableError, type Job } from 'bullmq';

/**
 * فشل كتبناه نحن على صف الطلب قبل ما نرميه لـ BullMQ.
 * بيرث UnrecoverableError (وبنسيب الـ name الافتراضي) عشان BullMQ يحط الصف في مجموعة الفاشل بلا إعادة محاولة،
 * وبيفضل مميَّزًا عن UnrecoverableError اللي BullMQ نفسه بيرميها عند تجاوز حد التوقف (وساعتها الكتابة لسه مطلوبة).
 */
export class FailurePersistedError extends UnrecoverableError {}

/**
 * بيكشف إن المهمة اتفعّلت تاني بعد تأخير أجّلناه إحنا: BullMQ بيزوّد attemptsStarted مع كل تفعيل
 * و attemptsMade مع كل محاولة فاشلة بس، والـ DelayedError ما بيزوّدش attemptsMade.
 * الفرق بعد طرح مرات التوقف هو عدد تأخيراتنا، وما بيعتمدش على مؤشر التقدم اللي ممكن كتابته تترفض.
 *
 * @param job المهمة اللي بتتفعّل
 * @returns true لو التفعيل ده بعد تأخير إنهاء أجّلناه
 */
export function reactivatedAfterDelay(
  job: Pick<Job, 'attemptsStarted' | 'attemptsMade' | 'stalledCounter'>,
): boolean {
  return job.attemptsStarted - job.attemptsMade - 1 - job.stalledCounter > 0;
}
