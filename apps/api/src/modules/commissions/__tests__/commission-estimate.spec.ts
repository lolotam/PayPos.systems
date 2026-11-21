import { employeeNameMatchKey } from '@pospay/domain';
import { createDatabase } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  insertCommissionLineProjection,
  type CommissionLineTenant,
} from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { startHarness } from '../../../../test/harness.ts';

const ids = systemUuidV7();
const PERIOD = '2026-11';

type EstimateHarness = Awaited<ReturnType<typeof startHarness>>;

type EstimateFixture = {
  readonly h: EstimateHarness;
  readonly cookie: string;
  readonly branchCookie: string;
  readonly company: string;
  readonly business: string;
  readonly branch: string;
  readonly employee: string;
  readonly secondEmployee: string;
  readonly tenant: CommissionLineTenant;
};

/**
 * يبني نشاطاً بموظفتين وارتباطات فروع، عشان التقدير يتسعّر بنداً ويقفل
 * الفلترة باليوم على نطاق الفروع (CS-Q20).
 */
async function estimateFixture(): Promise<EstimateFixture> {
  const h = await startHarness();
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
    employee,
    secondEmployee,
    tenant,
  };
}

async function seedBusiness(
  h: EstimateHarness,
  cookie: string,
  company: string,
): Promise<{ business: string; branch: string; secondBranch: string }> {
  const businessResponse = await h.send('POST', '/v1/businesses', {
    cookie,
    company,
    key: 'estimate-business',
    body: { vertical_type: 'salon', name_en: 'Estimate salon', timezone: 'Asia/Kuwait' },
  });
  const business = businessResponse.body['id'] as string;
  const branchResponse = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: 'estimate-branch',
    body: { name_en: 'Estimate branch' },
  });
  const secondResponse = await h.send('POST', `/v1/businesses/${business}/branches`, {
    cookie,
    company,
    key: 'estimate-second-branch',
    body: { name_en: 'Estimate second branch' },
  });
  return {
    business,
    branch: branchResponse.body['id'] as string,
    secondBranch: secondResponse.body['id'] as string,
  };
}

async function seedEmployees(
  h: EstimateHarness,
  company: string,
  business: string,
  branch: string,
): Promise<{ employee: string; secondEmployee: string }> {
  const employee = ids.newId();
  const secondEmployee = ids.newId();
  for (const [id, name, number] of [
    [employee, 'Sarah', 1],
    [secondEmployee, 'Nadia', 2],
  ] as const) {
    await h.owner`INSERT INTO employees(
      company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES (${company},${id},${business},${branch},${name},${employeeNameMatchKey(name)},
        'staff','2026-01-01',${number})`;
  }
  return { employee, secondEmployee };
}

async function seedCatalogue(
  h: EstimateHarness,
  company: string,
  business: string,
  branch: string,
  employee: string,
): Promise<CommissionLineTenant> {
  await h.owner`INSERT INTO services(company_id,id,business_id,name_en,price,commission_rule_kind)
    VALUES (${company},${ids.newId()},${business},'Estimate service',1.000,'ZERO')`;
  await h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
    VALUES (${company},${ids.newId()},'Estimate customer','+96500000011','ar',now(),now())`;
  const services = (await h.owner<{ id: string }[]>`SELECT id FROM services
    WHERE company_id=${company} AND business_id=${business} LIMIT 1`) ?? [];
  const customers = (await h.owner<{ id: string }[]>`SELECT id FROM customers
    WHERE company_id=${company} LIMIT 1`) ?? [];
  return {
    company,
    business,
    branch,
    employee,
    membership: '',
    service: services[0]?.id ?? '',
    customer: customers[0]?.id ?? '',
  };
}

async function seedAttachments(
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

async function seedLines(
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
  // موظفة تانية بتبني بدنها في الفرع التاني، عشان مدير الفرع الأول ما يشوفهاش.
  await db.withTenant(company, (tx) =>
    insertCommissionLineProjection(
      tx,
      { ...tenant, employee: secondEmployee, branch: secondBranch },
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
async function branchManager(f: {
  readonly h: EstimateHarness;
  readonly company: string;
  readonly business: string;
  readonly branch: string;
}): Promise<string> {
  const email = 'commission-estimate-branch-manager@example.test';
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = ids.newId();
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${f.company},'estimate_branch_reader','Estimate branch reader')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES (${role},${f.company},${f.company},'read:commissions:business')`;
  await f.h.owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${f.company},${membershipId},${user?.['id']},${role},${f.company},
      'BRANCH',${f.branch})`;
  return cookie;
}

let fixture: EstimateFixture;

beforeAll(async () => {
  fixture = await estimateFixture();
});

afterAll(async () => {
  await fixture?.h.close();
});

const estimatePath = (f: EstimateFixture, query = ''): string =>
  `/v1/businesses/${f.business}/commissions/periods/${PERIOD}/estimate${query}`;

const get = (f: EstimateFixture, query = '', actor = f.cookie) =>
  f.h.send('GET', estimatePath(f, query), { cookie: actor, company: f.company });

it('prices the month for the business-wide owner and leaves the database unchanged', async () => {
  const before = await countRows(fixture);
  const response = await get(fixture);

  expect(response.status).toBe(200);
  const body = response.body as {
    period: string;
    employees: { employee_id: string; total: string; status: string; partial: boolean }[];
    total: string;
  };
  expect(body.period).toBe(PERIOD);
  expect(body.employees).toHaveLength(2);
  expect(body.employees.map((employee) => employee.employee_id).sort()).toEqual(
    [fixture.employee, fixture.secondEmployee].sort(),
  );
  expect(body.employees.every((employee) => employee.status === 'OK')).toBe(true);
  expect(body.employees.every((employee) => employee.total === '1.000')).toBe(true);
  expect(body.total).toBe('2.000');
  expect(await countRows(fixture)).toEqual(before);
});

it('refuses a member without the read permission with the same 403', async () => {
  const email = 'commission-estimate-without-permission@example.test';
  const cookie = await fixture.h.signedInOperator(email);
  const [user] = await fixture.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = ids.newId();
  const membershipId = ids.newId();
  await fixture.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${role},${fixture.company},'estimate_reader','Estimate reader')`;
  await fixture.h.owner`INSERT INTO memberships(
    company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    VALUES (${fixture.company},${membershipId},${user?.['id']},${role},${fixture.company},
      'BUSINESS',${fixture.business})`;

  const response = await get(fixture, '', cookie);

  expect(response.status).toBe(403);
  expect((response.body as { code: string }).code).toBe('FORBIDDEN');
});

it('shows a branch reader only the days she was attached to her branch', async () => {
  const response = await get(fixture, '', fixture.branchCookie);

  expect(response.status).toBe(200);
  const body = response.body as {
    employees: { employee_id: string; total: string; partial: boolean }[];
    total: string;
  };
  expect(body.employees).toHaveLength(1);
  expect(body.employees[0]?.employee_id).toBe(fixture.employee);
  expect(body.employees[0]?.total).toBe('1.000');
  expect(body.total).toBe('1.000');
});

it('cannot reveal an inaccessible employee through the employee filter', async () => {
  const hidden = await get(fixture, `?employee_id=${fixture.secondEmployee}`, fixture.branchCookie);
  const absent = await get(
    fixture,
    '?employee_id=01920000-0000-7000-8000-0000000000ff',
    fixture.branchCookie,
  );

  expect(hidden.status).toBe(200);
  expect(hidden.body).toEqual(absent.body);
});

it('refuses an invalid period or an unknown business with a 400', async () => {
  const bad = await fixture.h.send(
    'GET',
    `/v1/businesses/${fixture.business}/commissions/periods/2026-13/estimate`,
    { cookie: fixture.cookie, company: fixture.company },
  );
  expect(bad.status).toBe(400);

  const missing = await fixture.h.send(
    'GET',
    '/v1/businesses/01920000-0000-7000-8000-0000000000ff/commissions/periods/2026-11/estimate',
    { cookie: fixture.cookie, company: fixture.company },
  );
  expect(missing.status).toBe(403);
});

async function countRows(f: EstimateFixture): Promise<number[]> {
  const [lines] = await f.h.owner`SELECT count(*)::int AS count FROM commission_lines`;
  const [statements] = await f.h.owner`SELECT count(*)::int AS count FROM commission_statements`;
  const [corrections] = await f.h.owner`SELECT count(*)::int AS count FROM commission_corrections`;
  const [generations] = await f.h.owner`SELECT count(*)::int AS count FROM commission_period_generations`;
  return [
    lines?.['count'] as number,
    statements?.['count'] as number,
    corrections?.['count'] as number,
    generations?.['count'] as number,
  ];
}
