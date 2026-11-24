import {
  isClosedBusinessReading,
  isGenerated,
  isOpenBusinessReading,
  type StatementReading,
} from './statement-reading';
import { statusOf } from './statement-display';

/**
 * بصمة النسخة اللي المستخدم شافها من الكشف: الحالة، وهل اتولّد، والبصمتين الحاليتين وبصمتَي المراجعة (أو بصمتَي الاعتماد المجمّدتين للشهر المغلق).
 * بتتاخد لحظة فتح حوار الأمر، وبتتقارن بقراءة جديدة قبل الإرسال: أي اختلاف معناه إن الكشف اتغيّر تحت
 * إيد المستخدم. مراجعة تانية على مدخلات ما اتغيّرتش بتدّي نفس البصمات، فالعميل ما يقدرش يكشفها.
 *
 * @param reading قراءة الكشف
 * @returns نص بيتساوى بس لو النسخة نفسها
 */
export function statementVersion(reading: StatementReading): string {
  const closedPrints = isClosedBusinessReading(reading)
    ? [reading.input_fingerprint, reading.statement_fingerprint]
    : [];
  const prints = isOpenBusinessReading(reading)
    ? [
        reading.current_fingerprint,
        reading.current_statement_fingerprint,
        reading.reviewed_fingerprint,
        reading.reviewed_statement_fingerprint,
      ]
    : closedPrints;
  return JSON.stringify([statusOf(reading), isGenerated(reading), ...prints]);
}
