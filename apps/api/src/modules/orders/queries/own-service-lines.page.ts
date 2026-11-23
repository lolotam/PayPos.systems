// مفاتيح الترتيب والعضوية فقط: لا مبلغ ولا اسم ولا عميل يصل هنا (spec 060 D-A7، MY-03).
export interface OwnLineKey {
  lineId: string;
  sessionId: string;
  businessDate: string;
  occurredAt: string;
  branchId: string;
}

export interface OwnLinePage {
  keys: OwnLineKey[];
  nextCursor: string | null;
}

// مقارنة code-unit صريحة: التواريخ والـ uuid بحروف صغيرة وبطول ثابت، فترتيبها هو ترتيب PostgreSQL الثنائي.
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const newestFirst = (a: OwnLineKey, b: OwnLineKey) =>
  compare(b.businessDate, a.businessDate) ||
  compare(b.occurredAt, a.occurredAt) ||
  compare(b.lineId, a.lineId);

/**
 * يقطع صفحة من مجموعة سطور الموظفة المرتبة بـ (business_date, occurred_at, line_id) تنازلياً.
 * العضوية في المجموعة هي التحقق الوحيد من المؤشر: سطر مجهول أو اتشال منها أو من شهر تاني أو نشاط تاني → null.
 * العقد يقبل uuid بحروف كبيرة وقاعدة البيانات تخزّنه بحروف صغيرة، فالمؤشر يتحوّل لحروف صغيرة قبل المقارنة.
 *
 * @param owned كل سطور الموظفة الحالية في الشهر المطلوب، بأي ترتيب
 * @param cursor line_id آخر صف في الصفحة السابقة، أو undefined للصفحة الأولى
 * @param limit حجم الصفحة
 * @returns الصفحة ومؤشر التالية، أو null لمؤشر ليس عضواً
 */
export function pageOwnLines(
  owned: readonly OwnLineKey[],
  cursor: string | undefined,
  limit: number,
): OwnLinePage | null {
  const ordered = [...owned].sort(newestFirst);
  const wanted = cursor?.toLowerCase();
  const anchor = wanted === undefined ? -1 : ordered.findIndex((key) => key.lineId === wanted);
  if (cursor !== undefined && anchor < 0) return null;
  const start = anchor + 1;
  const keys = ordered.slice(start, start + limit);
  const last = keys.at(-1);
  return { keys, nextCursor: last && start + limit < ordered.length ? last.lineId : null };
}

export interface OwnLineSession {
  businessDate: string;
  occurredAt: string;
  branchId: string;
}

export interface OwnLineSet {
  keys: OwnLineKey[];
  shares: ReadonlyMap<string, number>;
}

/**
 * يقاطع صفوف المنفذة الحالية مع زيارات الشهر ليخرج مجموعة سطورها، بلا أي عمود لزميلة.
 * سطر بلا زيارة في الشهر يسقط هنا، فالمجموعة هي حد العضوية الوحيد.
 *
 * @param performed صفوف line_performers للموظفة (line_id، وshare_bps لو العمود مسموح)
 * @param lineSession خريطة السطر إلى زيارته
 * @param sessions زيارات الشهر بمفاتيح ترتيبها وفرعها
 * @returns مفاتيح سطورها في الشهر وحصصها
 */
export function ownLineSet(
  performed: readonly { line_id: string; share_bps?: number }[],
  lineSession: ReadonlyMap<string, string>,
  sessions: ReadonlyMap<string, OwnLineSession>,
): OwnLineSet {
  const keys: OwnLineKey[] = [];
  const shares = new Map<string, number>();
  for (const row of performed) {
    const sessionId = lineSession.get(row.line_id);
    const session = sessionId === undefined ? undefined : sessions.get(sessionId);
    if (sessionId === undefined || session === undefined) continue;
    keys.push({ lineId: row.line_id, sessionId, ...session });
    if (row.share_bps !== undefined) shares.set(row.line_id, row.share_bps);
  }
  return { keys, shares };
}

export type OwnSessionRow = {
  id: string;
  business_date: string;
  occurred_at: string;
  branch_id: string;
};

/** يحول صفوف زيارات الشهر إلى خريطة بمفاتيح الترتيب والفرع. */
export const ownSessionMap = (rows: readonly OwnSessionRow[]) =>
  new Map<string, OwnLineSession>(
    rows.map((row) => [
      row.id,
      { businessDate: row.business_date, occurredAt: row.occurred_at, branchId: row.branch_id },
    ]),
  );

export const emptyOwnLineSet: OwnLineSet = { keys: [], shares: new Map() };
