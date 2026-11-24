import {
  commissionClosedStatementBranchView,
  commissionClosedStatementView,
  commissionStatementBranchView,
  commissionStatementView,
  type CommissionClosedStatementBranchView,
  type CommissionClosedStatementView,
  type CommissionStatementBranchView,
  type CommissionStatementView,
} from '@pospay/contracts';

/** رد قراءة الكشف: مفتوح (فيه بصمات حية لقارئ النشاط) أو مغلق (صفوفه المجمّدة)، لقارئ النشاط أو الفروع. */
export type StatementReading =
  | CommissionStatementView
  | CommissionStatementBranchView
  | CommissionClosedStatementView
  | CommissionClosedStatementBranchView;

/** رد الشهر المغلق: الصفوف المجمّدة من غير بصمة حية ولا حقل «اتولّد». */
export type ClosedStatementReading = CommissionClosedStatementView | CommissionClosedStatementBranchView;

/**
 * بيحلل رد القراءة بالسكيما اللي تخص نطاق القارئ وحالة الشهر: المعتمد والمصروف لهم شكلهم المجمّد،
 * وقارئ الفروع ما بيرجعش له بصمات.
 *
 * @param data الجسم زي ما جه من السيرفر
 * @returns الرد بعد التحليل
 */
export function parseStatementReading(data: unknown): StatementReading {
  const body = data as { reader_scope?: unknown; status?: unknown } | null;
  const business = body?.reader_scope === 'BUSINESS';
  if (body?.status === 'APPROVED' || body?.status === 'PAID') {
    return business ? commissionClosedStatementView.parse(data) : commissionClosedStatementBranchView.parse(data);
  }
  return business ? commissionStatementView.parse(data) : commissionStatementBranchView.parse(data);
}

/** هل الشهر مغلق (معتمد أو مصروف) وبيتعرض من صفوفه المجمّدة. */
export function isClosedReading(reading: StatementReading): reading is ClosedStatementReading {
  return reading.status === 'APPROVED' || reading.status === 'PAID';
}

/** هل الرد لقارئ النشاط كله على شهر مفتوح، يعني فيه بصمات ومسموح له بأزرار الكتابة. */
export function isOpenBusinessReading(reading: StatementReading): reading is CommissionStatementView {
  return reading.reader_scope === 'BUSINESS' && !isClosedReading(reading);
}

/** هل الكشف اتولّد: الشهر المغلق دايمًا متولّد، والمفتوح بحسب علم السيرفر. */
export function isGenerated(reading: StatementReading): boolean {
  return isClosedReading(reading) || reading.generated;
}
