import { employeeNameMatchKey } from '@pospay/domain';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import type { MarkCommissionStatementPaidInput } from '@pospay/contracts';

import { startHarness } from '../../../../test/harness.ts';
import {
  insertCommissionLine,
  walkCommissionStatement,
  type CommissionTenant,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';

export const ids = systemUuidV7();

// اليوم المحلي للنشاط وقت الصرف؛ تاريخ الاعتماد في البذرة 2026-11-02، فنافذة paid_on هي [11-02، 11-07].
export const MARK_PAID_NOW = new Date('2026-11-07T12:00:00.000Z');
export const PAID_ON = '2026-11-03';

/** جسم طلب الصرف الافتراضي: كاش بتاريخ صرف داخل النافذة وملاحظة. */
export function markPaidInput(
  overrides: Partial<MarkCommissionStatementPaidInput> = {},
): MarkCommissionStatementPaidInput {
  return { paid_method: 'CASH', paid_on: PAID_ON, paid_note: 'مع المرتب نهاية الشهر', ...overrides };
}

type Harness = Awaited<ReturnType<typeof startHarness>>;

async function seedBusiness(h: Harness, cookie: string, company: string) {
  const businessResponse = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key: 'statement-pay-business',
    body: { vertical_type: 'salon', name_en: 'Statement pay salon', timezone: 'Asia/Kuwait' },
  });
  const business = businessResponse.body['id'] as string;
  await h.owner`UPDATE businesses SET created_at='2026-01-01T00:00:00.000Z'
    WHERE company_id=${company} AND id=${business}`;
  const branchResponse = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: 'statement-pay-branch',
    body: { name_en: 'Statement pay branch' },
  });
  return { business, branch: branchResponse.body['id'] as string };
}

/** موظفة الكشف المجمّد ومبالغ بنود عمولتها؛ كل مبلغ بند مستقل جوّه حد العمود، ومجموعها هو صافيها. */
export interface FrozenEmployeeAmounts {
  readonly employee: string;
  readonly amounts: readonly string[];
}

/**
 * بيكتب صف كل موظفة المجمّد وبنود عمولتها بعد الاعتماد، في نفس معاملة الاعتماد.
 *
 * @param tx          معاملة الاعتماد نفسها
 * @param tenant      الشريحة صاحبة الكشف
 * @param statementId كشف الشهر المعتمد
 * @param employees   الموظفات ومبالغ بنودهن
 */
async function seedFrozenEmployeeLines(
  tx: Parameters<typeof insertCommissionLine>[0],
  tenant: CommissionTenant,
  statementId: string,
  employees: readonly FrozenEmployeeAmounts[],
): Promise<void> {
  for (const [index, { employee, amounts }] of employees.entries()) {
    await insertCommissionLine(tx, tenant, statementId, ids, {
      kind: 'EMPLOYEE',
      employeeId: employee,
      employeeNumber: index + 1,
      sourceRef: `employee:${employee}`,
    });
    for (const amount of amounts) {
      const lineId = ids.newId();
      await insertCommissionLine(tx, tenant, statementId, ids, {
        kind: 'COMMISSION',
        employeeId: employee,
        employeeNumber: index + 1,
        amount,
        lineId,
        sourceRef: `line:${lineId}`,
      });
    }
  }
}

/** موظفتان في النشاط: الأولى مربوطة بمستخدم صاحب الصرف، والتانية من غير مستخدم (لمجاميع الكشف الكبيرة). */
async function seedEmployees(
  h: Harness,
  tenant: { company: string; business: string; branch: string; userId: string },
) {
  const employee = ids.newId();
  const secondEmployee = ids.newId();
  await h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${tenant.company},${employee},${tenant.business},${tenant.branch},${tenant.userId},'Sara',${employeeNameMatchKey('Sara')},'staff','2026-01-01',1)`;
  await h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${tenant.company},${secondEmployee},${tenant.business},${tenant.branch},'Dana',${employeeNameMatchKey('Dana')},'staff','2026-01-01',2)`;
  return { employee, secondEmployee };
}

/**
 * بيبني نشاطاً بصاحب صلاحية الصرف وموظفة واحدة، والقراء مربوطين زي جذر التركيب.
 *
 * @returns الـ harness والشريحة ودالة طلب الصرف ودالة بذر شهر معتمد ببند عمولة
 */
export async function statementPayFixture(clock: () => Date = () => MARK_PAID_NOW) {
  const h = await startHarness({ commissionsClock: { now: clock } });
  const cookie = await h.signedInOperator('statement-pay-owner@example.test');
  const company = await h.onboard(cookie, 'Statement pay employer');
  const { business, branch } = await seedBusiness(h, cookie, company);
  const [owner] =
    await h.owner`SELECT id FROM "user" WHERE email='statement-pay-owner@example.test'`;
  const userId = owner?.['id'] as string;
  const [membership] = await h.owner`SELECT id FROM memberships
    WHERE company_id=${company} AND user_id=${userId} LIMIT 1`;
  const { employee, secondEmployee } = await seedEmployees(h, { company, business, branch, userId });
  const db = createDatabase({ url: h.urls.app, ids });
  const tenant: CommissionTenant = {
    company,
    business,
    branch,
    employee,
    membership: membership?.['id'] as string,
  };
  const approved = (period: string, employees: readonly FrozenEmployeeAmounts[]) =>
    walkCommissionStatement(db, {
      tenant,
      period,
      ids,
      reviewer: userId,
      afterApproved: (tx, statementId) => seedFrozenEmployeeLines(tx, tenant, statementId, employees),
    });
  return {
    h,
    db,
    cookie,
    company,
    business,
    branch,
    employee,
    secondEmployee,
    userId,
    tenant,
    pay: (
      period: string,
      body: MarkCommissionStatementPaidInput,
      key: string,
      actor = cookie,
    ) =>
      h.send(
        'POST',
        `/v1/businesses/${business}/commission-statements/${period}/mark-paid`,
        { cookie: actor, company, key, body },
      ),
    /** شهر جديد معتمد ببند عمولة واحد قيمته 41.003، عشان التقريب للكاش يبان. */
    approvedStatementWithCommission: (period: string) => approved(period, [{ employee, amounts: ['41.003'] }]),
    /** شهر جديد معتمد بموظفات ومبالغ بنود تحددها الحالة (للمبالغ الكبيرة). */
    approvedStatementWith: approved,
    /** شهر جديد مراجَع بس، عشان اختبار الرفض قبل الاعتماد. */
    reviewedStatement: (period: string) =>
      walkCommissionStatement(db, { tenant, period, ids, reviewer: userId, to: 'REVIEWED' }),
    close: async () => {
      await db.close();
      await h.close();
    },
  };
}

export type StatementPayFixture = Awaited<ReturnType<typeof statementPayFixture>>;

/** عضوية بدور مخصص بلا أي صلاحية، عشان اختبار CM-42 يثبت الرفض الموحّد. */
export async function memberWithoutPayPermission(f: StatementPayFixture) {
  const email = 'statement-pay-without-permission@example.test';
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = ids.newId();
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},'statement_viewer','Statement viewer')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${membershipId},${user?.['id'] as string},${role},${f.company},'BUSINESS',${f.business})`;
  return { cookie, userId: user?.['id'] as string };
}

/** عضوية بدور مخصص بصلاحية الصرف وقراءة النشاط كله (54-1-PAY-1)، ومعاها معرّف الدور عشان سحب الصلاحية. */
export async function payerMember(f: StatementPayFixture, label: string) {
  const email = `statement-payer-${label}-${ids.newId()}@example.test`;
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},${`payer_${label}_${role.slice(-6)}`.replaceAll('-', '_').replaceAll(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)))},'Statement payer')`;
  for (const permission of ['pay:commissions:business', 'read:commissions:business']) {
    await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES (${role},${f.company},${f.company},${permission})`;
  }
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${ids.newId()},${user?.['id'] as string},${role},${f.company},'BUSINESS',${f.business})`;
  return { cookie, userId: user?.['id'] as string, role };
}

/** يسحب صلاحية الصرف من دور عضوية بعد ما الطلب عدّى الحارس الخارجي. */
export async function withdrawPay(f: StatementPayFixture, role: string): Promise<void> {
  await f.h.owner`DELETE FROM role_permissions WHERE company_id=${f.company} AND role_id=${role}
    AND permission_code='pay:commissions:business'`;
}
