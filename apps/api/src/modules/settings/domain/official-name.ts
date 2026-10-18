/** الاسم الرسمي فاضي بعد القص، أو أطول من 255 حرف بعدد حروف Postgres. */
export class OfficialNameRejected extends Error {
  /**
   * بيرفض الاسم قبل ما يتكتب أو يتسجل.
   */
  constructor() {
    super('OFFICIAL_NAME_REJECTED');
    this.name = 'OfficialNameRejected';
  }
}

/**
 * بيقص الاسم الرسمي وبيرفض الفاضي أو الأطول من 255 حرف.
 * الاسم الرسمي منفصل عن اسم العرض (BI-Q2) والاتنين اختياريان (BI-Q4)، والمسافات حوالين النص مش جزء من الاسم.
 * العدد هو عدد حروف Postgres (`char_length`) مش عدد وحدات UTF-16.
 *
 * @param raw النص كما كتبه المستخدم
 * @returns الاسم بعد القص
 */
export function normalizeOfficialName(raw: string): string {
  const trimmed = raw.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > 255) throw new OfficialNameRejected();
  return trimmed;
}
