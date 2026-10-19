/** الاسم الرسمي فاضي بعد القص، أو أطول من 255 حرف، أو فيه NUL. */
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
 * بيقص الاسم الرسمي وبيرفض الفاضي أو الأطول من 255 حرف أو اللي فيه NUL.
 * الاسم الرسمي منفصل عن اسم العرض (BI-Q2) والاتنين اختياريان (BI-Q4)، والمسافات حوالين النص مش جزء من الاسم.
 * العدد هو عدد حروف Postgres (`char_length`) مش عدد وحدات UTF-16، ورفض NUL بيمنع 22021 من القاعدة.
 *
 * @param raw النص كما كتبه المستخدم
 * @returns الاسم بعد القص
 */
export function normalizeOfficialName(raw: string): string {
  if (raw.includes('\u0000')) throw new OfficialNameRejected();
  const trimmed = raw.trim();
  const length = [...trimmed].length;
  if (length < 1 || length > 255) throw new OfficialNameRejected();
  return trimmed;
}
