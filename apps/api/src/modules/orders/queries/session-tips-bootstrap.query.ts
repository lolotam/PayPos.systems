import type { Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

export interface CurrentSessionTipsRange { from: string; to: string }
/** مؤشر الصفحة: يوم الزيارة ومعرّفها معاً، عشان الترتيب باليوم ثم بالمعرّف يبقى ثابتاً. */
export interface CurrentSessionTipsCursor { business_date: string; session_id: string }
export interface CurrentSessionTipsPageRequest { after: CurrentSessionTipsCursor | null; limit: number }
export interface CurrentSessionTipEntry { employee_id: string; method: 'CASH' | 'CARD'; amount: string }
export interface CurrentSessionTips {
  session_id: string;
  business_date: string;
  revision: number;
  tips: CurrentSessionTipEntry[];
  event_ids: string[];
}
export interface CurrentSessionTipsPage { items: CurrentSessionTips[]; next_cursor: CurrentSessionTipsCursor | null }

type CurrentSessionTipsRow = {
  session_id: string;
  business_date: string;
  revision: number | string;
  event_ids: string[];
  employee_id: string | null;
  method: 'CASH' | 'CARD' | null;
  amount: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function validDate(value: string): boolean {
  const match = DATE.exec(value);
  if (match === null) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (lengths[month - 1] ?? 0);
}

function validateRequest(companyId: string, businessId: string,
  range: CurrentSessionTipsRange, page: CurrentSessionTipsPageRequest): void {
  if (!validDate(range.from) || !validDate(range.to) || range.from > range.to)
    throw new RangeError('SESSION_TIPS_BOOTSTRAP_RANGE_INVALID');
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 200)
    throw new RangeError('SESSION_TIPS_BOOTSTRAP_LIMIT_INVALID');
  // يوم المؤشر بره النطاق مش رفض: هو بس بيمشي بالصفحة لأول نقطة بعده في النطاق.
  if (page.after !== null && (!validDate(page.after.business_date) || !UUID.test(page.after.session_id)))
    throw new RangeError('SESSION_TIPS_BOOTSTRAP_CURSOR_INVALID');
  if (!UUID.test(companyId) || !UUID.test(businessId))
    throw new RangeError('SESSION_TIPS_BOOTSTRAP_SCOPE_INVALID');
}

// مستهلك bootstrap في الصف 50 يقرأ آخر مراجعة ومدخلاتها ومعرّفات أحداثها من لقطة واحدة.
// الصفحة بتُقاد من زيارات اليوم بمفتاح (اليوم، المعرّف) عشان التكلفة تبقى حجم الصفحة لا حجم
// جدول المراجعات كله؛ والزيارة بتعدّي بس لو عندها مراجعة بقشيش واحدة على الأقل.
export function currentSessionTipsStatement(companyId: string, businessId: string,
  range: CurrentSessionTipsRange, page: CurrentSessionTipsPageRequest): SQL {
  const after = page.after === null
    ? sql`TRUE`
    : sql`(s.business_date, s.id) > (${page.after.business_date}::date, ${page.after.session_id}::uuid)`;
  return sql`WITH picked AS (
    SELECT s.id AS session_id, s.business_date
    FROM service_sessions s
    WHERE s.company_id = ${companyId} AND s.company_id = app_company_id() AND s.business_id = ${businessId}
      AND s.business_date BETWEEN ${range.from}::date AND ${range.to}::date AND ${after}
      AND EXISTS (SELECT 1 FROM session_tip_revisions r
        WHERE r.company_id = s.company_id AND r.company_id = app_company_id()
          AND r.session_id = s.id AND r.business_id = s.business_id)
    ORDER BY s.business_date, s.id LIMIT ${page.limit + 1})
  SELECT p.session_id, to_char(p.business_date, 'YYYY-MM-DD') AS business_date, v.revision, v.event_ids,
    t.employee_id, t.method, t.amount::text AS amount
  FROM picked p
  LEFT JOIN LATERAL (
    SELECT max(r.revision) AS revision,
      (array_agg(r.id ORDER BY r.revision DESC))[1] AS revision_id,
      array_agg(r.event_id ORDER BY r.revision) AS event_ids
    FROM session_tip_revisions r
    WHERE r.company_id = ${companyId} AND r.company_id = app_company_id() AND r.business_id = ${businessId}
      AND r.session_id = p.session_id) v ON true
  LEFT JOIN LATERAL (SELECT t.employee_id, t.method, t.amount FROM session_tips t
    WHERE t.company_id = ${companyId} AND t.company_id = app_company_id() AND t.business_id = ${businessId}
      AND t.session_id = p.session_id AND t.revision_id = v.revision_id
    ORDER BY t.employee_id, t.method) t ON true
  ORDER BY p.business_date, p.session_id, t.employee_id, t.method`;
}

function groupRows(rows: readonly CurrentSessionTipsRow[]): CurrentSessionTips[] {
  const sessions = new Map<string, CurrentSessionTips>();
  for (const row of rows) {
    let current = sessions.get(row.session_id);
    if (current === undefined) {
      current = { session_id: row.session_id, business_date: row.business_date,
        revision: Number(row.revision), tips: [], event_ids: [...row.event_ids] };
      sessions.set(row.session_id, current);
    }
    if (row.employee_id === null || row.method === null || row.amount === null) continue;
    current.tips.push({ employee_id: row.employee_id, method: row.method, amount: row.amount });
  }
  return [...sessions.values()];
}

// سطر واحد يكشف ربطاً غلطاً: شركة لا تطابق مستأجر المعاملة تفشل بصوت عالٍ بدل صفحة فارغة تُقرأ كـ«لا بقشيش».
async function assertTenant(tx: Tx, companyId: string): Promise<void> {
  const rows = await tx.execute<{ company_id: string | null }>(
    sql`SELECT app_company_id()::text AS company_id`);
  const tenant = rows[0]?.company_id ?? null;
  if (tenant === null || tenant.toLowerCase() !== companyId.toLowerCase())
    throw new Error('SESSION_TIPS_BOOTSTRAP_TENANT_MISMATCH');
}

/**
 * يرجع صفحة من الزيارات التي لها مراجعات بقشيش، ومع كل زيارة أحدث مراجعة ومجموعتها الكاملة
 * وكل معرّفات أحداث مراجعاتها بترتيبها، بلا هاتف أو اسم عميلة أو سبب تعديل.
 * الاستعلام الواحد يثبّت المراجعة والمدخلات والأحداث في لقطة واحدة، والمؤشر بقى (يوم الزيارة،
 * معرّف الزيارة) والترتيب بقى باليوم ثم بالمعرّف، فالصفحة تمشي على فهرس اليوم بتاع النشاط
 * بدل ما تقرأ تاريخ المراجعات كله؛ أي مراجعة تُكتب بعد قراءة صفحتها يوصلها المستهلك الحي،
 * لذلك يبدأ المستهلك قبل أول صفحة ولا يعتمد bootstrap على إعادة قراءة الزيارة نفسها.
 * واختلاف شركة الاستدعاء عن مستأجر المعاملة يفشل بـ SESSION_TIPS_BOOTSTRAP_TENANT_MISMATCH
 * بدل صفحة فارغة، لأن Bootstrap يقرأ الصفحة الفارغة كـ«لا بقشيش» فيختفي خطأ الربط في صورة غياب بيانات.
 *
 * @param tx معاملة المستأجر التي فتحها المستدعي؛ القارئ لا يفتح معاملة ولا يكتب
 * @param companyId معرّف الشركة ويجب أن يطابق مستأجر المعاملة؛ الاختلاف يفشل بـ SESSION_TIPS_BOOTSTRAP_TENANT_MISMATCH
 * @param businessId معرّف النشاط المقصود
 * @param range يوما العمل بصيغة YYYY-MM-DD وكلاهما داخل النطاق
 * @param page مؤشر آخر زيارة في الصفحة السابقة (يومها ومعرّفها) وعدد الزيارات المطلوب من 1 إلى 200
 * @returns زيارات مرتبة باليوم ثم بالمعرّف مع مؤشر الصفحة التالية أو null عند نهاية النتائج
 */
export async function listCurrentSessionTips(
  tx: Tx, companyId: string, businessId: string,
  range: CurrentSessionTipsRange, page: CurrentSessionTipsPageRequest,
): Promise<CurrentSessionTipsPage> {
  validateRequest(companyId, businessId, range, page);
  await assertTenant(tx, companyId);
  const normalized = {
    after: page.after === null ? null : {
      business_date: page.after.business_date,
      session_id: page.after.session_id.toLowerCase(),
    },
    limit: page.limit,
  };
  const rows = await tx.execute<CurrentSessionTipsRow>(
    currentSessionTipsStatement(companyId, businessId, range, normalized));
  const sessions = groupRows(rows);
  const items = sessions.slice(0, page.limit);
  const last = items.at(-1);
  return {
    items,
    next_cursor: sessions.length > page.limit && last !== undefined
      ? { business_date: last.business_date, session_id: last.session_id }
      : null,
  };
}
