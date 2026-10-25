import { employeeNameMatchKey } from '@pospay/domain';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import {
  lockStatementPeriods,
  SYSTEM_ROLES,
  type Database,
  type IdGenerator,
  type StatementStatus,
  type Tx,
} from '../src/index.ts';
import { seedTwoTenants, TENANT, USER } from './tenancy-fixtures.ts';

export interface CommissionTenant {
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly employee: string;
  readonly membership: string;
}

export const COMMISSION_TENANT = {
  A: {
    ...TENANT.A,
    employee: '01920000-0000-7000-8000-000000000ca1',
    membership: '01920000-0000-7000-8000-000000000ca2',
  },
  B: {
    ...TENANT.B,
    employee: '01920000-0000-7000-8000-000000000cb1',
    membership: '01920000-0000-7000-8000-000000000cb2',
  },
} as const satisfies Record<string, CommissionTenant>;

export const OTHER_COMMISSION_IDS = {
  business: '01920000-0000-7000-8000-000000000cc1',
  branch: '01920000-0000-7000-8000-000000000cc2',
  employee: '01920000-0000-7000-8000-000000000cc3',
  line: '01920000-0000-7000-8000-000000000cc4',
  session: '01920000-0000-7000-8000-000000000cc5',
  service: '01920000-0000-7000-8000-000000000cc6',
  customer: '01920000-0000-7000-8000-000000000cc7',
} as const;

export const FINGERPRINTS = {
  current: 'a'.repeat(64),
  reviewed: 'b'.repeat(64),
  statement: 'c'.repeat(64),
  input: 'd'.repeat(64),
} as const;

async function seedEmployee(
  owner: postgres.Sql,
  tenant: CommissionTenant,
  name: string,
  employeeNumber: number,
): Promise<void> {
  await owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${tenant.company},${tenant.employee},${tenant.business},${tenant.branch},${USER},${name},
      ${employeeNameMatchKey(name)},'staff','2026-01-01',${employeeNumber})`;
}

/**
 * بيجهّز شريحتين بموظفين وعضويات، لأن جداول الكشف تشير للموظف من نفس النشاط في الـ FK.
 * التجهيز كله كـ pospay_owner (استثناء الاختبار، plan v4 T5).
 *
 * @param ownerUrl اتصال كـ pospay_owner بداتابيز الاختبار
 * @returns بيخلص لما الـ fixtures تبقى موجودة
 */
export async function seedCommissionStatementTenants(ownerUrl: string): Promise<void> {
  await seedTwoTenants(ownerUrl);
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await owner`INSERT INTO "user"(id,name,email)
      VALUES(${USER},'Commission operator','commission-operator@example.test')`;
    const ownerRole = SYSTEM_ROLES.find((role) => role.code === 'owner');
    if (ownerRole === undefined) throw new Error('the owner role is missing from SYSTEM_ROLES');
    for (const [index, tenant] of [COMMISSION_TENANT.A, COMMISSION_TENANT.B].entries()) {
      await seedEmployee(owner, tenant, `Employee ${index + 1}`, 1);
      await owner`INSERT INTO memberships(
        company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
        VALUES (${tenant.company},${tenant.membership},${USER},${ownerRole.id},'global','BUSINESS',${tenant.business})`;
    }
    const other = OTHER_COMMISSION_IDS;
    await owner`INSERT INTO businesses(company_id,id,vertical_type,name_en)
      VALUES(${TENANT.A.company},${other.business},'salon','Other commission business')`;
    await owner`INSERT INTO branches(company_id,id,business_id,name_en)
      VALUES(${TENANT.A.company},${other.branch},${other.business},'Other commission branch')`;
    await seedEmployee(
      owner,
      {
        ...TENANT.A,
        business: other.business,
        branch: other.branch,
        employee: other.employee,
        membership: other.employee,
      },
      'Other employee',
      2,
    );
  } finally {
    await owner.end();
  }
}

export interface WalkStatementOptions {
  readonly tenant: CommissionTenant;
  readonly period: string;
  readonly ids: IdGenerator;
  readonly to?: Exclude<StatementStatus, 'DRAFT'>;
  readonly afterReviewed?: (tx: Tx, statementId: string) => Promise<void>;
  readonly afterApproved?: (tx: Tx, statementId: string) => Promise<void>;
}

/**
 * بيمشي بكشف الشهر من DRAFT للحالة المطلوبة بالترتيب اللي تريغرات قاعدة البيانات بتقبله:
 * القفل الأول، ثم REVIEWED ببصمات المراجعة، ثم APPROVED؛ وده هو ترتيب بذر FR-044 كمان.
 *
 * @param db      الداتابيز اللي بتدور على المستأجر
 * @param options الشريحة والشهر ومولّد الـ ids والحالة المطلوبة وخطّاف بعد كل مرحلة
 * @returns معرّف كشف الشهر، عشان الاختبار يقرا عليه بره المعاملة
 */
export async function walkCommissionStatement(
  db: Database,
  options: WalkStatementOptions,
): Promise<string> {
  const { tenant, period, ids } = options;
  let statementId = '';
  await db.withTenant(tenant.company, async (tx) => {
    const [statement] = await lockStatementPeriods(tx, {
      businessId: tenant.business,
      periods: [period],
      ids,
    });
    if (statement === undefined) throw new Error('the statement row is missing after its lock');
    statementId = statement.statementId;
    await tx.execute(sql`UPDATE commission_statements SET status='REVIEWED',
      reviewed_fingerprint=${FINGERPRINTS.reviewed}, reviewed_statement_fingerprint=${FINGERPRINTS.statement},
      reviewed_by=${USER}, reviewed_membership_id=${tenant.membership}, reviewed_at='2026-11-01T08:00:00Z'
      WHERE company_id=${tenant.company} AND id=${statementId}`);
    await options.afterReviewed?.(tx, statementId);
    if (options.to === 'REVIEWED') return;
    await tx.execute(sql`UPDATE commission_statements SET status='APPROVED', approved_by=${USER},
      approved_at='2026-11-02T08:00:00Z', input_fingerprint=${FINGERPRINTS.input},
      statement_fingerprint=${FINGERPRINTS.statement}
      WHERE company_id=${tenant.company} AND id=${statementId}`);
    await options.afterApproved?.(tx, statementId);
    if (options.to === 'PAID') {
      await tx.execute(sql`UPDATE commission_statements SET status='PAID'
        WHERE company_id=${tenant.company} AND id=${statementId}`);
    }
  });
  return statementId;
}

export interface FrozenLineOverrides {
  readonly [key: string]: unknown;
  readonly kind?: string;
}

/**
 * بيبني مصفوفة uuid كقيمة SQL مكتوبة مش كمعامل مربوط: الدريزل بيوسّع أي مصفوفة جوه sql
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
 * بيكتب صف كشف مجمّد واحد؛ القيم الافتراضية بتمشي مع قيود الجدول (صف موظف بمبلغ صفر).
 *
 * @param tx          المعاملة الجارية — لازم تكون معاملة الاعتماد نفسها
 * @param tenant      الشريحة صاحب الصف
 * @param statementId كشف الشهر اللي بيتبنى عليه الصف
 * @param ids         مولّد الـ ids
 * @param row         قيم تتجاوز الافتراضي (نوع الصف والمبالغ والتواريخ)
 * @returns بيخلص لما الصف يتكتب
 */
export async function insertCommissionLine(
  tx: Tx,
  tenant: CommissionTenant,
  statementId: string,
  ids: IdGenerator,
  row: FrozenLineOverrides = {},
): Promise<void> {
  const kind = row['kind'] ?? 'EMPLOYEE';
  const correction = typeof kind === 'string' && kind.startsWith('CORRECTION');
  const noSource = kind === 'EMPLOYEE' || kind === 'CARRY_COMMISSION' || kind === 'CARRY_TIP_CARD';
  const value = (key: string, fallback: unknown) => (key in row ? row[key] : fallback);
  const attachedBranchIds = value('attachedBranchIds', []) as readonly string[];
  await tx.execute(sql`INSERT INTO commission_statement_lines(
    company_id,id,business_id,statement_id,employee_id,employee_number,employee_name_ar,employee_name_en,
    source_ref,kind,amount,previous_amount,new_amount,source_period,source_branch_id,source_business_date,
    attached_branch_ids,line_id,session_id,service_id,service_name_ar,service_name_en,customer_id,customer_name,business_date)
    VALUES (${value('companyId', tenant.company)},${ids.newId()},${value('businessId', tenant.business)},${statementId},
      ${value('employeeId', tenant.employee)},${value('employeeNumber', 1)},${value('employeeNameAr', null)},
      ${value('employeeNameEn', 'Frozen employee')},${value('sourceRef', `employee:${tenant.employee}`)},${kind},
      ${value('amount', kind === 'EMPLOYEE' ? '0.000' : correction ? '5.000' : '10.000')},
      ${value('previousAmount', correction ? '10.000' : null)},${value('newAmount', correction ? '15.000' : null)},
      ${value('sourcePeriod', null)},${value('sourceBranchId', noSource ? null : tenant.branch)},
      ${value('sourceBusinessDate', noSource ? null : '2026-10-15')},${uuidArraySql(attachedBranchIds)},
      ${value('lineId', kind === 'COMMISSION' ? OTHER_COMMISSION_IDS.line : null)},
      ${value('sessionId', kind === 'COMMISSION' ? OTHER_COMMISSION_IDS.session : null)},
      ${value('serviceId', kind === 'COMMISSION' ? OTHER_COMMISSION_IDS.service : null)},
      ${value('serviceNameAr', null)},${value('serviceNameEn', null)},${value('customerId', null)},
      ${value('customerName', null)},${value('businessDate', kind === 'COMMISSION' ? '2026-10-15' : null)})`);
}

type StatementPeriodRow = { period: string };

/**
 * بيدّي مدى شهر الكشف نفسه، عشان لقطة الارتباط ما تمتدّش بره شهرها (FR-033)؛
 * المدى الافتراضي في الكتابة هو شهر الكشف، والاختبار يقدر يمرّر غيره لما عايز حالة معيّنة.
 *
 * @param tx          المعاملة الجارية — لازم تكون معاملة الاعتماد نفسها
 * @param statementId كشف الشهر اللي بيتبنى عليه الصف
 * @returns مدى الشهر بالشكل اللي بيتخزّن في الجدول
 */
async function statementMonthRange(
  tx: Tx,
  statementId: string,
): Promise<{ attachedFrom: string; attachedTo: string }> {
  const [statement] = await tx.execute<StatementPeriodRow>(
    sql`SELECT period FROM commission_statements
      WHERE company_id = app_company_id() AND id = ${statementId}::uuid`,
  );
  const period = statement?.period;
  if (period === undefined) {
    throw new Error(`the statement ${statementId} is missing for its attachment`);
  }
  const [year, month] = period.split('-');
  const last = new Date(Number(year), Number(month), 0).getDate();
  return {
    attachedFrom: `${period}-01`,
    attachedTo: `${period}-${String(last).padStart(2, '0')}`,
  };
}

/**
 * بيكتب لقطة ارتباط الموظف بالفرع في الشهر المجمد؛ المدى لازم يكون جوه شهر الكشف.
 *
 * @param tx          المعاملة الجارية — لازم تكون معاملة الاعتماد نفسها
 * @param tenant      الشريحة صاحب الصف
 * @param statementId كشف الشهر اللي بيتبنى عليه الصف
 * @param ids         مولّد الـ ids
 * @param row         قيم تتجاوز الافتراضي (الفرع ومدى الارتباط)
 * @returns بيخلص لما الصف يتكتب
 */
export async function insertCommissionAttachment(
  tx: Tx,
  tenant: CommissionTenant,
  statementId: string,
  ids: IdGenerator,
  row: Record<string, unknown> = {},
): Promise<void> {
  const value = (key: string, fallback: unknown) => (key in row ? row[key] : fallback);
  const month = await statementMonthRange(tx, statementId);
  await tx.execute(sql`INSERT INTO commission_statement_attachments(
    company_id,id,business_id,statement_id,employee_id,branch_id,attached_from,attached_to)
    VALUES (${value('companyId', tenant.company)},${ids.newId()},${value('businessId', tenant.business)},${statementId},
      ${value('employeeId', tenant.employee)},${value('branchId', tenant.branch)},
      ${value('attachedFrom', month.attachedFrom)},${value('attachedTo', month.attachedTo)})`);
}

/**
 * بيتأكد إن الشغل رُفض بخطأ قاعدة بيانات بالـ code المطلوب، وباسم القيد لو اتقال.
 *
 * @param work       الشغل اللي المفروض يرفض
 * @param code       الـ SQLSTATE المتوقع (23514 قيد، 23503 مفتاح أجنبي، 42501 صلاحية أو RLS)
 * @param constraint اسم القيد المتوقع، لو الـ error بيرفعه
 * @returns بيخلص لما الرفض يبقى بالشكل المتوقع
 */
export async function expectPgError(
  work: Promise<unknown>,
  code: string,
  constraint?: string,
): Promise<void> {
  const { expect } = await import('vitest');
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const failure = error as Error & {
    code?: string;
    constraint_name?: string;
    cause?: { code?: string; constraint_name?: string };
  };
  const source = failure.code ? failure : (failure.cause ?? failure);
  expect(source.code).toBe(code);
  if (constraint !== undefined) expect(source.constraint_name).toBe(constraint);
}

/**
 * بيرجّع كود قاعدة البيانات اللي رفض الشغل من غير ما يثبّت أي اسم قيد؛
 * بيُستخدم مع الرفض اللي ممكن ييجي من التريغر أو من المفتاح الأجنبي، أيهم سبقه.
 *
 * @param work الشغل اللي المفروض يرفض
 * @returns الـ SQLSTATE اللي رفض بيه
 */
export async function refusalCode(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof Error)) throw new Error('the work was expected to be refused');
  const failure = error as Error & { code?: string; cause?: { code?: string } };
  return failure.code ?? failure.cause?.code ?? '';
}
