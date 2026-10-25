import { sql } from 'drizzle-orm';

import { assertUuid, type IdGenerator, type Tx } from './with-tenant.ts';

export type StatementStatus = 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID';

export interface LockedStatementPeriod {
  readonly period: string;
  readonly statementId: string;
  readonly status: StatementStatus;
}

// الـ generic بتاعة tx.execute لازم تكون type alias مش interface: الـ interface مالهاش
// index signature ضمنية، والـ constraint بتاع الـ driver بيقبل الـ type alias بس.
type StatementRow = { statementId: string; period: string; status: StatementStatus };

// العلامة دي بتركب في نص قفل المساعد نفسه، عشان harness الـ FR-004 يقدر يثبت إن الكاتب
// واقف على lockStatementPeriods نفسه مش على SELECT ... FOR UPDATE مكتوب بإيده.
export const LOCK_STATEMENT_PERIODS_MARKER = 'pospay:lockStatementPeriods';

export interface LockStatementPeriodsInput {
  readonly businessId: string;
  readonly periods: readonly string[];
  readonly ids: IdGenerator;
}

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

/**
 * خطأ شهر مغلق؛ التغيير على APPROVED أو PAID يُرفض حتى لا يتبدل كشف مالي مجمد.
 *
 * @param periods الشهور المغلقة التي ظهرت بعد أخذ أقفالها
 * @returns خطأً يحمل كل الشهور المرفوضة وكود COMMISSION_PERIOD_CLOSED
 */
export class StatementPeriodClosedError extends Error {
  readonly code = 'COMMISSION_PERIOD_CLOSED';
  readonly periods: readonly string[];

  constructor(periods: readonly string[]) {
    super(`Commission statement periods are closed: ${periods.join(', ')}`);
    this.name = 'StatementPeriodClosedError';
    this.periods = [...periods];
  }
}

/**
 * خطأ صيغة شهر؛ قبول YYYY-MM فقط يمنع قفل أو إنشاء كشف لشهر غير موجود.
 *
 * @param period القيمة التي لا تطابق صيغة الشهر
 * @returns خطأً يحمل القيمة وكود COMMISSION_PERIOD_FORMAT
 */
export class StatementPeriodFormatError extends Error {
  readonly code = 'COMMISSION_PERIOD_FORMAT';
  readonly period: string;

  constructor(period: string) {
    super(`Invalid commission statement period: ${period}`);
    this.name = 'StatementPeriodFormatError';
    this.period = period;
  }
}

function normalizePeriods(periods: readonly string[]): string[] {
  for (const period of periods) {
    // سنة 0000 مرفوضة زي أي صيغة غلط: to_date مش بيعرف يحوّلها، والجدول نفسه بيطلب سنة حقيقية.
    if (!PERIOD.test(period) || period.startsWith('0000-')) {
      throw new StatementPeriodFormatError(period);
    }
  }
  return [...new Set(periods)].sort();
}

/**
 * ينشئ كشف الشهر عند غيابه ثم يقفل صفوف الشهور المطلوبة تصاعدياً ويرجع حالاتها.
 * القاعدة: الكاتب يمرر كل الشهور التي يحتاجها في نداء واحد بأي ترتيب، ولا ينادي helper مرة ثانية
 * في المعاملة نفسها بشهر أقدم، لأن ذلك قد يصنع deadlock مع كاتب آخر؛ والشهر المغلق يُرفض عبر
 * assertStatementPeriodsOpen بعد القفل، ليرى الرفض الحالة كما صارت بعد أي انتظار.
 *
 * @param tx معاملة withTenant الحالية؛ لا تُفتح معاملة أخرى
 * @param input النشاط والشهور ومولد UUID v7 المحققن
 * @returns صفوف الشهور مرتبة تصاعدياً بمعرف الكشف وحالته بعد القفل
 */
export async function lockStatementPeriods(
  tx: Tx,
  input: LockStatementPeriodsInput,
): Promise<LockedStatementPeriod[]> {
  assertUuid(input.businessId, 'businessId');
  const periods = normalizePeriods(input.periods);
  if (periods.length === 0) return [];
  const locked: LockedStatementPeriod[] = [];
  for (const period of periods) {
    const id = input.ids.newId();
    await tx.execute(sql`
      INSERT INTO commission_statements (company_id, id, business_id, period, status)
      VALUES (app_company_id(), ${id}::uuid, ${input.businessId}::uuid, ${period}, 'DRAFT')
      ON CONFLICT (company_id, business_id, period) DO NOTHING`);
    const [row] = await tx.execute<StatementRow>(sql`
      ${sql.raw(`/* ${LOCK_STATEMENT_PERIODS_MARKER} */`)}
      SELECT id AS "statementId", period, status FROM commission_statements
      WHERE company_id = app_company_id() AND business_id = ${input.businessId}::uuid
        AND period = ${period}
      FOR UPDATE`);
    if (row === undefined) {
      throw new Error(`Statement period ${period} is invisible after its insert or conflict`);
    }
    locked.push({ statementId: row.statementId, period: row.period, status: row.status });
  }
  return locked;
}

/**
 * يرفض كل الشهور APPROVED أو PAID في نتيجة القفل قبل أول كتابة على مدخلاتها.
 *
 * @param locked نتيجة lockStatementPeriods بعد اكتمال انتظار الأقفال
 * @returns لا شيء عندما تكون كل الشهور DRAFT أو REVIEWED
 */
export function assertStatementPeriodsOpen(locked: readonly LockedStatementPeriod[]): void {
  const closed = locked
    .filter(({ status }) => status === 'APPROVED' || status === 'PAID')
    .map(({ period }) => period);
  if (closed.length > 0) throw new StatementPeriodClosedError(closed);
}
