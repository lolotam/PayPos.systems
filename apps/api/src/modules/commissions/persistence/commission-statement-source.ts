import type {
  OpenBlockedCorrection,
  StatementEmployeeLabel,
  StatementLineHead,
  StatementMonthRows,
  StatementNames,
} from '@pospay/commissions-engine';
import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';

import { employeeLeftBeforeMonth } from '../domain/employment-overlap.ts';
import { completeNames, MISSING_NAME_PLACEHOLDER } from '../domain/statement-names.ts';
import type {
  CommissionStatementRecord,
  CommissionStatementSource,
} from '../ports/commission-statement.port.ts';
import type {
  CommissionStatementEmployeeName,
  CommissionStatementProviders,
} from '../ports/commission-statement-providers.port.ts';
import { readEstimateMonth } from './commission-estimate-readers.ts';

/**
 * قائمة معرّفات كمعامل واحد بصيغة مصفوفة Postgres (نص `{a,b}` يتحوّل `uuid[]`)، بدل معامل لكل معرّف اللي
 * ممكن يعدّي حد 65,535 معامل في شهر كبير. المعرّفات جاية من الداتابيز نفسها فمفيش محتوى حر.
 *
 * @param ids معرّفات UUID
 * @returns نص المصفوفة
 */
function uuidArray(ids: readonly string[]): string {
  return `{${ids.join(',')}}`;
}

const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** طلب قراءة مصادر الكشف: الشركة والنشاط والشهر. */
export interface CommissionStatementSourceRequest {
  readonly companyId: string;
  readonly businessId: string;
  readonly period: string;
}

type HeadRow = {
  lineId: string;
  sessionId: string;
  serviceId: string;
  customerId: string;
  businessDate: string;
};

type BlockedRow = { employeeId: string; sourcePeriod: string; code: string };

type StatementRow = {
  status: CommissionStatementRecord['status'];
  currentFingerprint: string | null;
  reviewedFingerprint: string | null;
  reviewedStatementFingerprint: string | null;
};

/**
 * يقرأ صف الكشف ببصماته، أو `null` لو الشهر ما اتكتبش له صف لسه. القراءة من غير قفل: القارئ ما بيقفلش،
 * والكاتب بياخد القفل قبل ما يناديها.
 *
 * @param tx معاملة الشركة الحالية
 * @param request الشركة والنشاط والشهر
 * @returns حالة الكشف وبصماته، أو null
 */
async function readStatementRecord(
  tx: Tx,
  request: CommissionStatementSourceRequest,
): Promise<CommissionStatementRecord | null> {
  const [row] = await tx.execute<StatementRow>(sql`SELECT status,
    current_fingerprint AS "currentFingerprint", reviewed_fingerprint AS "reviewedFingerprint",
    reviewed_statement_fingerprint AS "reviewedStatementFingerprint"
    FROM commission_statements
    WHERE company_id = ${request.companyId} AND business_id = ${request.businessId}::uuid
      AND period = ${request.period}`);
  return row ?? null;
}

/**
 * التصحيحات الموقوفة المفتوحة اللي كشفها المحتجز هو الشهر ده: بتدخل بصمة المدخلات وبتمنع المراجعة
 * (FR-027، FR-046، CS-Q38).
 *
 * @param tx معاملة الشركة الحالية
 * @param request الشركة والنشاط والشهر
 * @returns الموظفة وشهر المصدر وكود التوقف
 */
async function readOpenBlocked(
  tx: Tx,
  request: CommissionStatementSourceRequest,
): Promise<OpenBlockedCorrection[]> {
  const rows = await tx.execute<BlockedRow>(sql`SELECT employee_id AS "employeeId",
    source_period AS "sourcePeriod", code AS "code"
    FROM commission_blocked_corrections
    WHERE company_id = ${request.companyId} AND business_id = ${request.businessId}::uuid
      AND target_period = ${request.period} AND resolved_at IS NULL
    ORDER BY employee_id, source_period`);
  return rows.map((row) => ({
    employeeId: row.employeeId,
    sourcePeriod: row.sourcePeriod,
    code: row.code === 'NO_SALARY' ? 'NO_SALARY' : 'NO_PLAN',
  }));
}

/**
 * رؤوس البنود اللي التصحيحات المستلمة بتشير لها، بمعرّف البند، لكل البنود مهما كان شهرها أو حالتها
 * (ACTIVE أو CANCELLED): بند من شهر أقدم أو ملغي لسه صف تصحيحه محتاج تفاصيله (FR-033، D-20).
 *
 * @param tx معاملة الشركة الحالية
 * @param companyId الشركة المؤكدة
 * @param sourceRefs مراجع مصادر التصحيحات
 * @returns رأس كل بند لقيناه، بمعرّف البند
 */
async function readCorrectionLineHeads(
  tx: Tx,
  companyId: string,
  sourceRefs: readonly string[],
): Promise<ReadonlyMap<string, StatementLineHead>> {
  // `source_ref` عمود نصي، فبنقبل بس اللي شكله UUID قبل ما يدخل مصفوفة الاستعلام؛ مرجع تالف ما يكسرش الكشف.
  const lineIds = [
    ...new Set(
      sourceRefs
        .filter((ref) => ref.startsWith('line:'))
        .map((ref) => ref.slice(5))
        .filter((id) => UUID_TEXT.test(id)),
    ),
  ].sort();
  const heads = new Map<string, StatementLineHead>();
  if (lineIds.length === 0) return heads;
  const rows = await tx.execute<HeadRow>(sql`SELECT line_id AS "lineId", session_id AS "sessionId",
    service_id AS "serviceId", customer_id AS "customerId", business_date::text AS "businessDate"
    FROM commission_line_heads
    WHERE company_id = ${companyId} AND line_id = ANY(${uuidArray(lineIds)}::uuid[])`);
  for (const row of rows) {
    heads.set(row.lineId, {
      sessionId: row.sessionId,
      serviceId: row.serviceId,
      customerId: row.customerId,
      businessDate: row.businessDate,
    });
  }
  return heads;
}

/**
 * كل معرّف اسم الكشف محتاجه: الفروع والخدمات والعملاء، من صفوف الشهر ومن رؤوس تصحيحاته.
 *
 * @param month صفوف الشهر
 * @param heads رؤوس البنود المصدر للتصحيحات
 * @returns مجموعات المعرّفات المطلوبة
 */
function referencedIds(
  month: StatementMonthRows,
  heads: ReadonlyMap<string, StatementLineHead>,
): { branches: Set<string>; services: Set<string>; customers: Set<string> } {
  const branches = new Set<string>();
  const services = new Set<string>();
  const customers = new Set<string>();
  for (const line of month.lines) {
    branches.add(line.branchId);
    services.add(line.serviceId);
    if (line.customerId !== null) customers.add(line.customerId);
  }
  for (const sale of month.sales) branches.add(sale.branchId);
  for (const tip of month.tips) branches.add(tip.branchId);
  for (const correction of month.corrections) branches.add(correction.sourceBranchId);
  for (const head of heads.values()) {
    services.add(head.serviceId);
    if (head.customerId !== null) customers.add(head.customerId);
  }
  return { branches, services, customers };
}

/**
 * يقرأ الأسماء الكاملة ويكمّلها: كل معرّف مشار له بيطلع له اسم، والناقص بياخد بديل الاسم (D-21)،
 * فالباني ما بيرميش على فرع اتشال أو عميل اتمسح اسمه.
 *
 * @param tx معاملة الشركة الحالية
 * @param request الشركة والنشاط والشهر
 * @param providers مزودو الأسماء
 * @param ids المعرّفات المشار لها
 * @returns الأسماء بكل المعرّفات
 */
async function readNames(
  tx: Tx,
  request: CommissionStatementSourceRequest,
  providers: CommissionStatementProviders,
  ids: ReturnType<typeof referencedIds>,
): Promise<StatementNames> {
  const { companyId, businessId } = request;
  const placeholder = { nameAr: null, nameEn: MISSING_NAME_PLACEHOLDER };
  const branches = await providers.branchNames(tx, companyId, businessId, [...ids.branches]);
  const services = await providers.serviceNames(tx, companyId, businessId, [...ids.services]);
  const customers = await providers.customerNames(tx, companyId, [...ids.customers]);
  return {
    branches: completeNames(ids.branches, branches, placeholder),
    services: completeNames(ids.services, services, placeholder),
    customers: completeNames(ids.customers, customers, MISSING_NAME_PLACEHOLDER),
  };
}

/**
 * يجمّع الموظفات في النطاق: كل موظفة مدة عملها بتغطي الشهر، وكل موظفة ليها أي مصدر أو تصحيح أو مرحّل
 * فيه (FR-033).
 *
 * @param employees موظفات النشاط ببطاقاتهن
 * @param month صفوف الشهر
 * @returns بطاقات الموظفات في النطاق مرتبة بالمعرّف
 */
function inScopeLabels(
  employees: readonly CommissionStatementEmployeeName[],
  month: StatementMonthRows,
  period: string,
): StatementEmployeeLabel[] {
  const withRows = new Set<string>();
  for (const line of month.lines) withRows.add(line.employeeId);
  for (const sale of month.sales) if (sale.sellerEmployeeId !== null) withRows.add(sale.sellerEmployeeId);
  for (const tip of month.tips) withRows.add(tip.employeeId);
  for (const correction of month.corrections) withRows.add(correction.employeeId);
  for (const carry of month.carries) withRows.add(carry.employeeId);
  return employees
    .filter((employee) => employee.employedDuringPeriod || withRows.has(employee.employeeId))
    .map((employee) => statementLabel(employee, period));
}

/**
 * يبني بطاقة الموظفة ومعاها علامة «سابت الشغل» (CM-50). القاعدة دايماً من التاريخ الخام عبر المجال، عشان
 * العلامة وقاعدة «في النطاق» يقرأوا نفس اليوم المحلي.
 *
 * @param employee موظفة النشاط
 * @param period الشهر بصيغة YYYY-MM
 * @returns البطاقة بعلامتها
 */
function statementLabel(
  employee: CommissionStatementEmployeeName,
  period: string,
): StatementEmployeeLabel {
  const departed = employeeLeftBeforeMonth(
    { contractEnd: employee.contractEnd, deletedOn: employee.deletedOn },
    period,
  );
  return {
    employeeId: employee.employeeId,
    employeeNumber: employee.employeeNumber,
    nameAr: employee.nameAr,
    nameEn: employee.nameEn,
    departed,
  };
}

/**
 * بطاقات الموظفات اللي عليهن تصحيح موقوف مفتوح وبرا مجموعة الكشف (مفيش لهن مصدر ولا تعيين بيغطي الشهر):
 * بتظهر لقارئ النشاط كله مع مانعها، من غير ما تتحوّل لصف EMPLOYEE في الكشف المجمّد (FR-027، FR-033).
 *
 * @param all موظفات النشاط ببطاقاتهن
 * @param listed بطاقات مجموعة الكشف
 * @param blocked التصحيحات الموقوفة المفتوحة
 * @returns بطاقات الموظفات اللي مانعهن الوحيد تصحيح موقوف
 */
function unlistedBlocked(
  all: readonly CommissionStatementEmployeeName[],
  listed: readonly StatementEmployeeLabel[],
  blocked: readonly OpenBlockedCorrection[],
  period: string,
): StatementEmployeeLabel[] {
  const listedIds = new Set(listed.map((employee) => employee.employeeId));
  const blockedIds = new Set(blocked.map((block) => block.employeeId));
  return all
    .filter((employee) => blockedIds.has(employee.employeeId) && !listedIds.has(employee.employeeId))
    .map((employee) => statementLabel(employee, period));
}

/**
 * يقرأ كل مصادر كشف الشهر من معاملة واحدة، لقراءة العرض ولكتابة الإنشاء: صفوف الشهر والتصحيحات
 * الموقوفة وبطاقات الموظفات وارتباطاتهن والأسماء ورؤوس البنود وصف الكشف. الاتنين بيستعملوا نفس
 * الدالة علشان بصمة العرض هي بالظبط اللي الإنشاء بيخزّنها.
 *
 * @param tx معاملة الشركة الحالية
 * @param request الشركة والنشاط والشهر
 * @param providers مزودو الوحدات صاحبة البيانات
 * @returns مصادر الكشف
 */
export async function readCommissionStatementSource(
  tx: Tx,
  request: CommissionStatementSourceRequest,
  providers: CommissionStatementProviders,
): Promise<CommissionStatementSource> {
  const { companyId, businessId, period } = request;
  const statement = await readStatementRecord(tx, request);
  const month = await readEstimateMonth(tx, companyId, businessId, period, null);
  const blocked = await readOpenBlocked(tx, request);
  const heads = await readCorrectionLineHeads(
    tx,
    companyId,
    month.corrections.map((correction) => correction.sourceRef),
  );
  const allEmployees = await providers.employees(tx, companyId, businessId, period);
  const employees = inScopeLabels(allEmployees, month, period);
  const attachments = await providers.attachments(
    tx,
    companyId,
    businessId,
    employees.map((employee) => employee.employeeId),
    period,
  );
  const names = await readNames(tx, request, providers, referencedIds(month, heads));
  const unlisted = unlistedBlocked(allEmployees, employees, blocked, period);
  return {
    statement,
    employees,
    attachments,
    month,
    blocked,
    unlisted,
    names,
    correctionLineDetails: heads,
  };
}
