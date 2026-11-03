import { commissionPlanEmployeeList } from '@pospay/contracts';
import { employeeNameMatchKey } from '@pospay/domain';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { takeTestEmployeeNumbers } from '../../../../test/test-employee-number.ts';
import {
  approvedDeviceToken,
  closeCommissionFixture,
  commissionPlanVersionsFixture,
  ids,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

type PlanEmployeeFixture = {
  f: CommissionPlanFixture;
  /** أربع موظفات باسم واحد: التكرار في الاسم ما يكسّرش ترتيب الصفحة المفتاحية. */
  shared: string[];
  otherBusiness: string;
  otherBusinessEmployee: string;
  deletedEmployee: string;
  otherCompanyEmployee: string;
  foreignBusiness: string;
  accountant: string;
  employeesManager: string;
};

const listPath = (businessId: string) => `/v1/businesses/${businessId}/commission-plan-employees`;

async function insertEmployee(
  f: CommissionPlanFixture,
  input: {
    id: string;
    companyId: string;
    businessId: string;
    branchId: string;
    nameEn: string;
    nameAr?: string | null;
    number: number;
    deleted?: boolean;
  },
): Promise<void> {
  await f.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,employee_number,deleted_at)
    VALUES(${input.companyId},${input.id},${input.businessId},${input.branchId},${input.nameAr ?? null},
      ${input.nameEn},${employeeNameMatchKey(input.nameEn)},'staff','2026-01-01',${input.number},
      ${input.deleted === true ? new Date('2026-10-01T00:00:00.000Z') : null})`;
}

/** عضو بدور نظامي: المحاسب عنده صلاحية الخطط بس، ومدير الموظفين عنده صلاحية الموظفين بس. */
async function memberWithRole(
  f: CommissionPlanFixture,
  email: string,
  roleCode: string,
): Promise<string> {
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const role = SYSTEM_ROLES.find((entry) => entry.code === roleCode)?.id as string;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${f.company},${ids.newId()},${user?.['id'] as string},${role},'global','BUSINESS',${f.business},'2026-01-01')`;
  return cookie;
}

/** نشاط تاني في نفس الشركة بفرعه: موظفينه لازم ما يظهروش في قائمة نشاط الهدف. */
async function otherBusinessScope(
  f: CommissionPlanFixture,
): Promise<{ otherBusiness: string; otherBusinessBranch: string }> {
  const { h } = f;
  const otherBusinessResponse = await h.send('POST', '/v1/businesses', {
    cookie: f.cookie,
    company: f.company,
    key: 'plan-employee-other-business',
    body: {
      vertical_type: 'salon',
      name_en: 'Plan employees other business',
      timezone: 'Asia/Kuwait',
    },
  });
  const otherBusiness = otherBusinessResponse.body['id'] as string;
  const otherBranchResponse = await h.send('POST', `/v1/businesses/${otherBusiness}/branches`, {
    cookie: f.cookie,
    company: f.company,
    key: 'plan-employee-other-branch',
    body: { name_en: 'Plan employees other branch' },
  });
  return { otherBusiness, otherBusinessBranch: otherBranchResponse.body['id'] as string };
}

/** شركة تانية بنشاطها وفرعها: سلبي الـ RLS، ونشاطها بيترفض بنفس 403 بتاع النشاط المش موجود. */
async function foreignScope(
  f: CommissionPlanFixture,
): Promise<{ foreignBusiness: string; otherCompanyEmployee: string }> {
  const { h } = f;
  const otherCompany = await h.onboard(f.cookie, 'Plan employees other company');
  const foreignBusiness = ids.newId();
  const foreignBranch = ids.newId();
  await h.owner`INSERT INTO businesses(company_id,id,name_en,vertical_type,timezone)
    VALUES(${otherCompany},${foreignBusiness},'Plan employees foreign business','salon','Asia/Kuwait')`;
  await h.owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES(${otherCompany},${foreignBranch},${foreignBusiness},'Plan employees foreign branch')`;
  const otherCompanyEmployee = ids.newId();
  await insertEmployee(f, {
    id: otherCompanyEmployee,
    companyId: otherCompany,
    businessId: foreignBusiness,
    branchId: foreignBranch,
    nameEn: 'Foreign employee',
    number: takeTestEmployeeNumbers(otherCompany, 1),
  });
  return { foreignBusiness, otherCompanyEmployee };
}

async function planEmployeeFixture(): Promise<PlanEmployeeFixture> {
  const f = await commissionPlanVersionsFixture();
  const { otherBusiness, otherBusinessBranch } = await otherBusinessScope(f);
  const { foreignBusiness, otherCompanyEmployee } = await foreignScope(f);
  const shared = Array.from({ length: 4 }, () => ids.newId());
  const numbers = takeTestEmployeeNumbers(f.company, shared.length + 3);
  for (const [index, id] of shared.entries()) {
    await insertEmployee(f, {
      id,
      companyId: f.company,
      businessId: f.business,
      branchId: f.branch,
      nameEn: 'Sara',
      nameAr: index === 0 ? 'سارة' : null,
      number: numbers + index,
    });
  }
  const deletedEmployee = ids.newId();
  await insertEmployee(f, {
    id: deletedEmployee,
    companyId: f.company,
    businessId: f.business,
    branchId: f.branch,
    nameEn: 'Deleted employee',
    number: numbers + shared.length,
    deleted: true,
  });
  const otherBusinessEmployee = ids.newId();
  await insertEmployee(f, {
    id: otherBusinessEmployee,
    companyId: f.company,
    businessId: otherBusiness,
    branchId: otherBusinessBranch,
    nameEn: 'Other business employee',
    number: numbers + shared.length + 1,
  });

  return {
    f,
    shared,
    otherBusiness,
    otherBusinessEmployee,
    deletedEmployee,
    otherCompanyEmployee,
    foreignBusiness,
    accountant: await memberWithRole(f, 'plan-employee-accountant@example.test', 'accountant'),
    employeesManager: await memberWithRole(
      f,
      'plan-employee-manager@example.test',
      'business_manager',
    ),
  };
}

let fx: PlanEmployeeFixture;
beforeEach(async () => {
  fx = await planEmployeeFixture();
});
afterEach(async () => {
  await closeCommissionFixture(fx.f);
});

async function list(
  query = '',
  actor = fx.f.cookie,
  businessId = fx.f.business,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return fx.f.h.send('GET', `${listPath(businessId)}${query}`, {
    cookie: actor,
    company: fx.f.company,
  });
}

async function pageAll(limit: number): Promise<string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const query =
      cursor === null ? `?limit=${limit}` : `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`;
    const response = await list(query);
    expect(response.status).toBe(200);
    const body = commissionPlanEmployeeList.parse(response.body);
    seen.push(...body.items.map((item) => item.id));
    if (body.next_cursor === null) return seen;
    cursor = body.next_cursor;
  }
  throw new Error('the pages did not end');
}

it('FR-010a the accountant without the employees permission reaches the plan list', async () => {
  const response = await list('', fx.accountant);
  expect(response.status).toBe(200);
  const body = commissionPlanEmployeeList.parse(response.body);
  expect(body.items.map((item) => item.id)).toContain(fx.f.employee);
  expect(body.items.map((item) => item.employee_number)).toContain(1);
  expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
    'employee_number',
    'id',
    'name_ar',
    'name_en',
  ]);
});

it('FR-010a an employees manager without the plan permission is refused', async () => {
  const response = await list('', fx.employeesManager);
  expect([response.status, response.body['code']]).toEqual([403, 'FORBIDDEN']);
});

it('FR-010a a disabled commissions feature refuses the list', async () => {
  await fx.f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${fx.f.company},'commissions',false,'Synthetic disabled',${fx.f.userId})`;
  const response = await list();
  expect([response.status, response.body['code']]).toEqual([403, 'FEATURE_DISABLED']);
});

it('FR-010a a device session is refused', async () => {
  const token = await approvedDeviceToken(fx.f);
  const response = await fx.f.h.app.inject({
    method: 'GET',
    url: listPath(fx.f.business),
    headers: { authorization: `Device ${token}`, 'x-company-id': fx.f.company },
  });
  expect(response.statusCode).toBe(403);
});

it('FR-010a another tenant employee is absent and a foreign business is refused like a missing one', async () => {
  const listed = await list();
  expect(listed.status).toBe(200);
  const listedIds = commissionPlanEmployeeList.parse(listed.body).items.map((item) => item.id);
  expect(listedIds).not.toContain(fx.otherCompanyEmployee);
  const missing = await list('', fx.f.cookie, ids.newId());
  const foreign = await list('', fx.f.cookie, fx.foreignBusiness);
  expect([missing.status, missing.body['code']]).toEqual([403, 'FORBIDDEN']);
  expect([foreign.status, foreign.body['code']]).toEqual([missing.status, missing.body['code']]);
});

it('FR-010a deleted and other-business employees are absent', async () => {
  const body = commissionPlanEmployeeList.parse((await list()).body);
  const listedIds = body.items.map((item) => item.id);
  expect(listedIds).not.toContain(fx.deletedEmployee);
  expect(listedIds).not.toContain(fx.otherBusinessEmployee);
  expect(listedIds).toContain(fx.f.employee);
});

it('FR-010a the page carries the business timezone and not the branch one', async () => {
  await fx.f.h.owner`UPDATE branches SET timezone='Asia/Riyadh'
    WHERE company_id=${fx.f.company} AND id=${fx.f.branch}`;
  const body = commissionPlanEmployeeList.parse((await list()).body);
  expect(body.time_zone).toBe('Asia/Kuwait');
});

it('FR-010a the raw page carries exactly its own keys', async () => {
  const response = await list();
  expect(Object.keys(response.body)).toEqual(['time_zone', 'items', 'next_cursor']);
  const items = response.body['items'] as Record<string, unknown>[];
  for (const item of items) {
    expect(Object.keys(item).sort()).toEqual(['employee_number', 'id', 'name_ar', 'name_en']);
  }
});

it('FR-010a an empty list is a 200 with the timezone and no cursor', async () => {
  // موظف النشاط التاني الوحيد بيتحذف حذف منطقي، فالقائمة تبقى فاضية فعلاً.
  await fx.f.h.owner`UPDATE employees SET deleted_at=now()
    WHERE company_id=${fx.f.company} AND id=${fx.otherBusinessEmployee}`;
  const response = await list('', fx.f.cookie, fx.otherBusiness);
  expect(response.status).toBe(200);
  expect(response.body['items']).toEqual([]);
  expect(response.body['time_zone']).toBe('Asia/Kuwait');
  expect(response.body['next_cursor']).toBeNull();
});

it('FR-010a a malformed cursor is refused', async () => {
  const broken = await list('?cursor=not-a-cursor');
  expect([broken.status, broken.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
  const illegal = await list('?cursor=abc/123');
  expect([illegal.status, illegal.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
});

it('FR-010a a cursor from another business is refused', async () => {
  const first = await list('?limit=2');
  const cursor = commissionPlanEmployeeList.parse(first.body).next_cursor;
  expect(cursor).not.toBeNull();
  const crossed = await list(
    `?limit=2&cursor=${encodeURIComponent(cursor as string)}`,
    fx.f.cookie,
    fx.otherBusiness,
  );
  expect([crossed.status, crossed.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
});

// مؤشر مزوّر بالإيد زي ما المهاجم هيبنيه، بمعرّف موظفة محذوفة أو معرّف مش موجود وبنفس المفتاح.
// الردّين لازم يبقوا واحد، وإلا المؤشر بيكشف إن المعرّف ده كان موظفة في النشاط. الشكل الأول (معرّف
// بس) كان بيكشفه لأن الـ SQL كان بيقرأ صف المرساة؛ دلوقتي بيترفض، والشكل بالمفتاح بيرجّع نفس الصفحة.
function forgedCursor(employeeId: string, key: string | null): string {
  const scope = { v: 1, c: fx.f.company, b: fx.f.business };
  const payload = key === null ? { ...scope, i: employeeId } : { ...scope, k: key, i: employeeId };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

it.each([
  ['the id-only form', null, 400, 0],
  ['the sort-key form', employeeNameMatchKey('Deleted employee'), 200, 2],
])(
  'FR-010a a forged cursor in %s does not tell a deleted employee from a missing one',
  async (_form, key, status, items) => {
    const deleted = await list(`?limit=2&cursor=${forgedCursor(fx.deletedEmployee, key)}`);
    const missing = await list(`?limit=2&cursor=${forgedCursor(ids.newId(), key)}`);
    expect(deleted.status).toBe(status);
    // الصفحة اللي بعد المفتاح فيها موظفات فعلاً، فالتطابق مش جاي من صفحتين فاضيين.
    expect((deleted.body['items'] as unknown[] | undefined) ?? []).toHaveLength(items);
    expect([deleted.status, deleted.body]).toEqual([missing.status, missing.body]);
  },
);

it('FR-010a the pages cover every employee once, in the stored order', async () => {
  const seen = await pageAll(2);
  const mine = seen.filter((id) => fx.shared.includes(id));
  expect(mine).toEqual([...fx.shared].sort());
  expect(new Set(mine).size).toBe(mine.length);
});

it('FR-010a a soft-deleted anchor between the pages does not end the list', async () => {
  const first = await list('?limit=2');
  const body = commissionPlanEmployeeList.parse(first.body);
  const anchor = body.items[body.items.length - 1]?.id as string;
  await fx.f.h.owner`UPDATE employees SET deleted_at=now()
    WHERE company_id=${fx.f.company} AND id=${anchor}`;
  const second = await list(`?limit=2&cursor=${encodeURIComponent(body.next_cursor as string)}`);
  expect(second.status).toBe(200);
  const next = commissionPlanEmployeeList.parse(second.body);
  expect(next.items.map((item) => item.id)).toEqual([...fx.shared].sort().slice(2));
  expect(next.items.map((item) => item.id)).not.toContain(anchor);
});
