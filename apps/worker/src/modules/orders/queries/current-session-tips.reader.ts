import { listCurrentSessionTips, type Tx } from '@pospay/db';
import { sql, type SQL } from 'drizzle-orm';

/** زيارة بحالة بقشيشها: المراجعة ومجموعتها الكاملة ومعرّفات أحداث المراجعات. */
export interface CurrentSessionTipsSession {
  readonly sessionId: string;
  readonly businessDate: string;
  readonly branchId: string;
  readonly revision: number;
  readonly tips: {
    readonly employeeId: string;
    readonly method: 'CASH' | 'CARD';
    readonly amount: string;
  }[];
  readonly eventIds: string[];
}

/** صفحة زيارات بحالة بقشيشها ومؤشر الصفحة التالية. */
export interface CurrentSessionTipsPage {
  readonly items: CurrentSessionTipsSession[];
  readonly nextCursor: { readonly businessDate: string; readonly sessionId: string } | null;
}

/**
 * يقرأ صفحة من الزيارات التي لها مراجعات بقشيش، ويلحق بكل زيارة فرعها؛ قارئ الحالة لا يعيد
 * الفرع، وإسقاط البقشيش يحتاجه ليكتب رأس الجلسة على فرعها الصحيح.
 *
 * @param tx معاملة المستأجر التي فتحها المستدعي؛ القارئ لا يفتح معاملة ولا يكتب
 * @param companyId الشركة المالكة للزيارات
 * @param businessId النشاط المطلوب قراءته
 * @param range نطاق يومي العمل بصيغة YYYY-MM-DD
 * @param page مؤشر آخر زيارة في الصفحة السابقة وعدد الزيارات المطلوبة
 * @returns زيارات الحالة ومؤشر الصفحة التالية أو null عند آخر صفحة
 */
export async function readCurrentSessionTips(
  tx: Tx,
  companyId: string,
  businessId: string,
  range: { readonly from: string; readonly to: string },
  page: {
    readonly after: { readonly businessDate: string; readonly sessionId: string } | null;
    readonly limit: number;
  },
): Promise<CurrentSessionTipsPage> {
  const read = await listCurrentSessionTips(
    tx,
    companyId,
    businessId,
    { from: range.from, to: range.to },
    {
      after:
        page.after === null
          ? null
          : { business_date: page.after.businessDate, session_id: page.after.sessionId },
      limit: page.limit,
    },
  );
  const branches = await readBranchIds(
    tx,
    companyId,
    businessId,
    read.items.map((item) => item.session_id),
  );
  const items = read.items.map((item) => {
    const branchId = branches.get(item.session_id);
    if (branchId === undefined) throw new Error('SESSION_TIPS_BOOTSTRAP_BRANCH_MISSING');
    return {
      sessionId: item.session_id,
      businessDate: item.business_date,
      branchId,
      revision: item.revision,
      tips: item.tips.map((tip) => ({
        employeeId: tip.employee_id,
        method: tip.method,
        amount: tip.amount,
      })),
      eventIds: [...item.event_ids],
    };
  });
  const next = read.next_cursor;
  return {
    items,
    nextCursor:
      next === null ? null : { businessDate: next.business_date, sessionId: next.session_id },
  };
}

/** استعلام فروع الزيارات — يستعمله بحث فرع الزيارات في تهيئة البقشيش، ومصدَّر عشان اختبار EXPLAIN يفحص مخططه. */
export function sessionBranchesStatement(
  companyId: string,
  businessId: string,
  sessionIds: readonly string[],
): SQL {
  return sql`
    SELECT id, branch_id FROM service_sessions
     WHERE company_id = ${companyId} AND business_id = ${businessId}
       AND id = ANY(ARRAY[${sql.join(
         sessionIds.map((sessionId) => sql`${sessionId}`),
         sql`, `,
       )}]::uuid[])`;
}

/** فروع الزيارات في نفس المعاملة، لأن قراءة فرع ناقصة تسقط الجلسة كلها ولا تُترك صامتة. */
async function readBranchIds(
  tx: Tx,
  companyId: string,
  businessId: string,
  sessionIds: readonly string[],
): Promise<Map<string, string>> {
  const branches = new Map<string, string>();
  if (sessionIds.length === 0) return branches;
  const rows = await tx.execute<{ id: string; branch_id: string }>(
    sessionBranchesStatement(companyId, businessId, sessionIds),
  );
  for (const row of rows) branches.set(row.id, row.branch_id);
  return branches;
}
