import {
  commissionStatementBranchView,
  commissionStatementView,
  type CommissionStatementBranchView,
  type CommissionStatementView,
} from '@pospay/contracts';

/** رد قراءة الكشف: قارئ النشاط كله أو قارئ الفروع، وكل شكل بسكيماه. */
export type StatementReading = CommissionStatementView | CommissionStatementBranchView;

/**
 * بيحلل رد القراءة بالسكيما اللي تخص نطاق القارئ: قارئ النشاط بيرجع البصمات وقارئ الفروع لأ.
 *
 * @param data الجسم زي ما جه من السيرفر
 * @returns الرد بعد التحليل
 */
export function parseStatementReading(data: unknown): StatementReading {
  const scope = (data as { reader_scope?: unknown } | null)?.reader_scope;
  return scope === 'BUSINESS'
    ? commissionStatementView.parse(data)
    : commissionStatementBranchView.parse(data);
}

/** هل الرد لقارئ النشاط كله، يعني فيه بصمات ومسموح له بأزرار الكتابة. */
export function isBusinessReading(reading: StatementReading): reading is CommissionStatementView {
  return reading.reader_scope === 'BUSINESS';
}
