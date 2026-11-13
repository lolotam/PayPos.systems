import { sql } from 'drizzle-orm';

import { lockStatementPeriods, type Database, type IdGenerator, type Tx } from '../src/index.ts';
import type { CommissionTenant } from './commission-statement-fixtures.ts';

type RowOverrides = Record<string, unknown>;

const value = (row: RowOverrides, key: string, fallback: unknown) =>
  key in row ? row[key] : fallback;

export interface TargetStatementRequest {
  readonly db: Database;
  readonly companyId: string;
  readonly businessId: string;
  readonly period: string;
  readonly ids: IdGenerator;
}

/**
 * بيقفل كشف الشهر الهدف عشان التصحيح يتعلّق بيه بالمفتاح المركّب: من غير كشف بنفس الشهر
 * والنشاط، الـ FK بيرفض الصف.
 *
 * @param request الداتابيز والشركة والنشاط والشهر ومولّد الـ ids
 * @returns معرّف كشف الشهر الهدف
 */
export async function lockTargetStatement(request: TargetStatementRequest): Promise<string> {
  let statementId = '';
  await request.db.withTenant(request.companyId, async (tx) => {
    const [locked] = await lockStatementPeriods(tx, {
      businessId: request.businessId,
      periods: [request.period],
      ids: request.ids,
    });
    if (locked === undefined) throw new Error('the target statement row is missing after its lock');
    statementId = locked.statementId;
  });
  return statementId;
}

/**
 * بيكتب مصفوفة uuid كقيمة SQL مكتوبة مش كمعامل مربوط: الدريزل بيوسّع أي مصفوفة جوه sql
 * لعناصر مفصولة بفاصلة، فالمصفوفة الفاضية بتبقى استدعاء مش صالح.
 *
 * @param list المعرفات المرتبة
 * @returns تعبير SQL من نوع uuid[]
 */
function uuidArraySql(list: readonly string[]) {
  if (list.length === 0) return sql`'{}'::uuid[]`;
  return sql`ARRAY[${sql.join(
    list.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]::uuid[]`;
}

/**
 * يدرج صف أجيال شهر لموظف، مع تجاوزات محدودة لاختبار قيود قاعدة البيانات.
 *
 * @param tx         المعاملة الجارية — لازم تكون معاملة المستأجر نفسه
 * @param tenant     الشريحة صاحب الصف
 * @param ids        مولّد الـ ids
 * @param overrides  قيم تتجاوز الافتراضي (الشهر والجيل والموظفة)
 * @returns معرّف الصف اللي اتكتب
 */
export async function insertCommissionGeneration(
  tx: Tx,
  tenant: CommissionTenant,
  ids: IdGenerator,
  overrides: RowOverrides = {},
): Promise<string> {
  const id = value(overrides, 'id', ids.newId()) as string;
  await tx.execute(sql`INSERT INTO commission_period_generations(
    company_id,id,business_id,employee_id,period,generation)
    VALUES(${value(overrides, 'companyId', tenant.company)},${id},
      ${value(overrides, 'businessId', tenant.business)},
      ${value(overrides, 'employeeId', tenant.employee)},
      ${value(overrides, 'period', '2026-10')},${value(overrides, 'generation', 1)})`);
  return id;
}

/**
 * يدرج صف تصحيح واحد، مع تجاوزات محدودة لاختبار قيود قاعدة البيانات.
 * الافتراضي يبني صفاً صحيحاً: شهر مصدر قبل شهر الهدف، والمبلغ هو الفرق بين الجديد والقديم.
 *
 * @param tx                المعاملة الجارية — لازم تكون معاملة المستأجر نفسه
 * @param tenant            الشريحة صاحب الصف
 * @param ids               مولّد الـ ids
 * @param targetStatementId كشف الشهر الهدف اللي بيستقبل التصحيح
 * @param overrides         قيم تتجاوز الافتراضي (النوع والمبالغ والفروع)
 * @returns معرّف الصف اللي اتكتب
 */
export async function insertCommissionCorrection(
  tx: Tx,
  tenant: CommissionTenant,
  ids: IdGenerator,
  targetStatementId: string,
  overrides: RowOverrides = {},
): Promise<string> {
  const id = value(overrides, 'id', ids.newId()) as string;
  const attachedBranchIds = value(overrides, 'attachedBranchIds', []) as readonly string[];
  await tx.execute(sql`INSERT INTO commission_corrections(
    company_id,id,business_id,employee_id,source_period,target_period,target_statement_id,source_ref,
    kind,amount,previous_amount,new_amount,generation,event_id,created_at,source_branch_id,
    source_business_date,attached_branch_ids)
    VALUES(${value(overrides, 'companyId', tenant.company)},${id},
      ${value(overrides, 'businessId', tenant.business)},
      ${value(overrides, 'employeeId', tenant.employee)},
      ${value(overrides, 'sourcePeriod', '2026-10')},${value(overrides, 'targetPeriod', '2026-11')},
      ${value(overrides, 'targetStatementId', targetStatementId)},
      ${value(overrides, 'sourceRef', `line:${ids.newId()}`)},
      ${value(overrides, 'kind', 'COMMISSION')},${value(overrides, 'amount', '5.000')},
      ${value(overrides, 'previousAmount', '10.000')},${value(overrides, 'newAmount', '15.000')},
      ${value(overrides, 'generation', 1)},${value(overrides, 'eventId', ids.newId())},
      ${value(overrides, 'createdAt', '2026-11-01T08:00:00Z')},
      ${value(overrides, 'sourceBranchId', tenant.branch)},
      ${value(overrides, 'sourceBusinessDate', '2026-10-15')},${uuidArraySql(attachedBranchIds)})`);
  return id;
}
