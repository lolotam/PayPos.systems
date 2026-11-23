import { employeeNameMatchKey } from '@pospay/domain';
import { createDatabase, SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import type { DestinationStream } from '@pospay/observability';

import {
  insertCommissionLineProjection,
  type CommissionLineTenant,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { startHarness } from '../../../../test/harness.ts';

export const ids = systemUuidV7();
export const PERIOD = '2026-11';
export const PERMISSION = 'read:commissions:business';

/** رقم العميل بيتزادد لكل عميل مزروع، عشان التليفون يفضل فريد في الشركة. */
let customerPhone = 0;

export type EstimateHarness = Awaited<ReturnType<typeof startHarness>>;

export type EstimateFixture = {
  readonly h: EstimateHarness;
  readonly cookie: string;
  readonly branchCookie: string;
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly secondBranch: string;
  readonly employee: string;
  readonly secondEmployee: string;
  readonly tenant: CommissionLineTenant;
};

/**
 * يبني نشاطاً بموظفتين وارتباطات فروع، عشان التقدير يتسعّر بنداً ويقفل
 * الفلترة باليوم على نطاق الفروع (CS-Q20).
 */
export async function estimateFixture(
  options: { logs?: DestinationStream; commissionsClock?: { now(): Date } } = {},
): Promise<EstimateFixture> {
  const h = await startHarness(options);
  const cookie = await h.signedInOperator('commission-estimate-owner@example.test');
  const company = await h.onboard(cookie, 'Commission estimate employer');
  const { business, branch, secondBranch } = await seedBusiness(h, cookie, company);
  const { employee, secondEmployee } = await seedEmployees(h, company, business, branch);
  const tenant = await seedCatalogue(h, company, business, branch, employee);
  await seedAttachments(h, company, business, employee, secondEmployee, branch, secondBranch);
  await seedLines(h, company, tenant, secondEmployee, secondBranch);
  const branchCookie = await branchManager({ h, company, business, branch });
  return {
    h,
    cookie,
    branchCookie,
    company,
    business,
    branch,
    secondBranch,
    employee,
    secondEmployee,
    tenant,
  };
}

export async function seedBusiness(
  h: EstimateHarness,
  cookie: string,
  company: string,
  key = 'estimate-business',
): Promise<{ business: string; branch: string; secondBranch: string }> {
  const businessResponse = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key,
    body: { vertical_type: 'salon', name_en: 'Estimate salon', timezone: 'Asia/Kuwait' },
  });
  const business = businessResponse.body['id'] as string;
  const branchResponse = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: `${key}-branch`,
    body: { name_en: 'Estimate branch' },
  });
  const secondResponse = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: `${key}-second-branch`,
    body: { name_en: 'Estimate second branch' },
  });
  return {
    business,
    branch: branchResponse.body['id'] as string,
    secondBranch: secondResponse.body['id'] as string,
  };
}

/**
 * نشاط من غير فروع، عشان إثبات إن DENY على نشاط تاني ما بيخصّش نشاط من غير
 * فروع (القارئ على مستوى النشاط بيشوف نشاط كله).
 */
export async function seedBusinessWithoutBranches(
  h: EstimateHarness,
  cookie: string,
  company: string,
  key = 'estimate-branchless-business',
): Promise<{ business: string }> {
  const response = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key,
    body: { vertical_type: 'salon', name_en: 'Estimate branchless salon', timezone: 'Asia/Kuwait' },
  });
  return { business: response.body['id'] as string };
}

export async function seedEmployees(
  h: EstimateHarness,
  company: string,
  business: string,
  branch: string,
  firstNumber = 1,
): Promise<{ employee: string; secondEmployee: string }> {
  const employee = ids.newId();
  const secondEmployee = ids.newId();
  for (const [id, name, number] of [
    [employee, 'Sarah', firstNumber],
    [secondEmployee, 'Nadia', firstNumber + 1],
  ] as const) {
    await h.owner`INSERT INTO employees(
      company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES (${company},${id},${business},${branch},${name},${employeeNameMatchKey(name)},
        'staff','2026-01-01',${number})`;
  }
  return { employee, secondEmployee };
}

export async function seedCatalogue(
  h: EstimateHarness,
  company: string,
  business: string,
  branch: string,
  employee: string,
): Promise<CommissionLineTenant> {
  const serviceId = ids.newId();
  const customerId = ids.newId();
  customerPhone += 1;
  await h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${company},${serviceId},${business},'Estimate service',1.000,'ZERO')`;
  await h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES (${company},${customerId},'Estimate customer',${`+9655${String(customerPhone).padStart(7, '0')}`},'ar',now(),now())`;
  return {
    company,
    business,
    branch,
    employee,
    membership: '',
    service: serviceId,
    customer: customerId,
  };
}

export async function seedAttachments(
  h: EstimateHarness,
  company: string,
  business: string,
  employee: string,
  secondEmployee: string,
  branch: string,
  secondBranch: string,
): Promise<void> {
  const attachments = [
    [employee, branch, '2026-11-01', null],
    [employee, secondBranch, '2026-12-01', null],
    [secondEmployee, secondBranch, '2026-11-01', null],
  ] as const;
  for (const [employeeId, branchId, from, to] of attachments) {
    await h.owner`INSERT INTO employee_branches(
      company_id,id,business_id,employee_id,branch_id,"from","to")
      VALUES (${company},${ids.newId()},${business},${employeeId},${branchId},${from}::date,${to}::date)`;
  }
}

export async function seedLines(
  h: EstimateHarness,
  company: string,
  tenant: CommissionLineTenant,
  secondEmployee: string,
  secondBranch: string,
): Promise<void> {
  const db = createDatabase({ url: h.urls.app, ids });
  await db.withTenant(company, (tx) =>
    insertCommissionLineProjection(tx, tenant, ids, {
      lineId: ids.newId(),
      businessDate: '2026-11-05',
      period: PERIOD,
      net: '10.000',
      ruleKind: 'PCT',
      rulePctBps: 1000,
    }),
  );
  // موظفة تانية بتبني بدنها في الفرع التاني، عشان مدير الفرع الأول ما يشوفهاش؛
  // وخدمتها مختلفة عشان اسم الخدمة المحجوب ما يظهرش في رد القارئ.
  const secondService = ids.newId();
  await h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${company},${secondService},${tenant.business},'Hidden service',1.000,'ZERO')`;
  await db.withTenant(company, (tx) =>
    insertCommissionLineProjection(
      tx,
      { ...tenant, employee: secondEmployee, branch: secondBranch, service: secondService },
      ids,
      {
        lineId: ids.newId(),
        businessDate: '2026-11-05',
        period: PERIOD,
        net: '10.000',
        ruleKind: 'PCT',
        rulePctBps: 1000,
      },
    ),
  );
  await db.close();
}

/**
 * عضوية على مستوى الفرع الأول وصلاحية القراءة، عشان نطاق فروعها يبقى
 * مختلفاً عن نطاق المالك على مستوى النشاط (CS-Q20).
 */
export async function branchManager(f: {
  readonly h: EstimateHarness;
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  /** لاحقة بتفرّق قارئ فرع تاني في نفس الشركة عن الأول. */
  readonly suffix?: string;
}): Promise<string> {
  const suffix = f.suffix ?? '';
  const email = `commission-estimate-branch-manager${suffix}@example.test`;
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = ids.newId();
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},${`estimate_branch_reader${suffix}`},'Estimate branch reader')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES (${role},${f.company},${f.company},${PERMISSION})`;
  await f.h.owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${membershipId},${user?.['id']},${role},${f.company},
      'BRANCH',${f.branch})`;
  return cookie;
}

/** عضوية بدور نظام عالمي، عشان إثبات الافتراضات الخمسة على المسار نفسه. */
export async function globalRoleMember(
  f: {
    readonly h: EstimateHarness;
    readonly company: string;
    readonly business: string;
    readonly branch: string;
  },
  roleCode: string,
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId?: string,
): Promise<{ cookie: string; userId: string; membershipId: string }> {
  const email = `commission-estimate-global-${roleCode}-${ids.newId()}@example.test`;
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = SYSTEM_ROLES.find((entry) => entry.code === roleCode)?.id ?? '';
  const membershipId = ids.newId();
  const scope =
    scopeId ??
    (scopeType === 'COMPANY' ? f.company : scopeType === 'BUSINESS' ? f.business : f.branch);
  await f.h.owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${membershipId},${user?.['id']},${role}::uuid,'global',
      ${scopeType},${scope}::uuid)`;
  return { cookie, userId: user?.['id'] as string, membershipId };
}

/** عضوية بدور مخصص من غير صلاحيات، عشان المنح الشخصي يفتح الصلاحية عليه. */
export async function customRoleMember(
  f: {
    readonly h: EstimateHarness;
    readonly company: string;
    readonly business: string;
    readonly branch: string;
  },
  code: string,
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH' = 'BUSINESS',
): Promise<{ cookie: string; userId: string; membershipId: string }> {
  const email = `commission-estimate-custom-${code}-${ids.newId()}@example.test`;
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = ids.newId();
  const membershipId = ids.newId();
  const scopeId =
    scopeType === 'COMPANY' ? f.company : scopeType === 'BUSINESS' ? f.business : f.branch;
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},${code},'Estimate custom role')`;
  await f.h.owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${membershipId},${user?.['id']},${role},${f.company},
      ${scopeType},${scopeId}::uuid)`;
  return { cookie, userId: user?.['id'] as string, membershipId };
}

/** عضوية تانية لنفس المستخدم، عشان الـ DENY يجي من عضوية مختلفة (CM-23g). */
export async function secondMembership(
  f: {
    readonly h: EstimateHarness;
    readonly company: string;
    readonly business: string;
    readonly branch: string;
  },
  userId: string,
  roleCode: string,
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
): Promise<string> {
  const role = SYSTEM_ROLES.find((entry) => entry.code === roleCode)?.id ?? '';
  const membershipId = ids.newId();
  const scopeId =
    scopeType === 'COMPANY' ? f.company : scopeType === 'BUSINESS' ? f.business : f.branch;
  await f.h.owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${membershipId},${userId},${role}::uuid,'global',
      ${scopeType},${scopeId}::uuid)`;
  return membershipId;
}

/** صلاحية شخصية على عضوية موجودة: ALLOW أو DENY بنطاق محدد. */
export async function permissionOverride(
  f: { readonly h: EstimateHarness; readonly company: string; readonly business: string },
  membershipId: string,
  effect: 'ALLOW' | 'DENY',
  scope: { readonly type: 'COMPANY' | 'BUSINESS' | 'BRANCH'; readonly id: string },
  expiresAt: string | null = null,
): Promise<string> {
  const id = ids.newId();
  const [user] = await f.h.owner`SELECT id FROM "user" LIMIT 1`;
  await f.h.owner`INSERT INTO permission_overrides(
    company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by,expires_at)
    VALUES (${f.company},${id}::uuid,${membershipId}::uuid,${PERMISSION},${effect},
      ${scope.type},${scope.id}::uuid,'estimate scope proof',${user?.['id']}::uuid,
      ${expiresAt === null ? null : expiresAt}::timestamptz)`;
  return id;
}

export const estimatePath = (business: string, period = PERIOD, query = ''): string =>
  `/v1/businesses/${business}/commissions/periods/${period}/estimate${query}`;
