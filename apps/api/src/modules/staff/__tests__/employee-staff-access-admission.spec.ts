import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import type { TenantOptions, TenantWrappers, Tx } from '@pospay/db';
import {
  addEmployee,
  grant,
  nextPhone,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';

const ids = systemUuidV7();

let f: Fixture;
/** معاملات الشركة اللي فتحها use case المنح — بوابة إثبات العضوية مش محسوبة هنا. */
let tenantTransactions = 0;

beforeAll(async () => {
  f = await staffAccessFixture({
    staffAccessRoutes: true,
    wrapDatabase: (database: TenantWrappers): TenantWrappers => ({
      ...database,
      withTenant: <T>(companyId: string, work: (tx: Tx) => Promise<T>, options?: TenantOptions) => {
        tenantTransactions += 1;
        return database.withTenant(companyId, work, options);
      },
    }),
  });
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

/** حاجز حقيقي: يوقف الاستدعاء عند نقطة معروفة لحد ما الاختبار يحرره. */
function barrier(count = 1) {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached!: () => void;
  const entered = new Promise<void>((resolve) => {
    reached = resolve;
  });
  let calls = 0;
  return {
    entered,
    release,
    arrive: async () => {
      if (++calls === count) reached();
      await wait;
    },
  };
}

/** شركة كاملة بنشاط وموظفة — كل شركة في الاختبار مستقلة عشان ما تتداخلش مع غيرها. */
interface Company {
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
}

async function companyWithEmployee(name: string, employeeNumber: number): Promise<Company> {
  const companyId = await f.h.onboard(f.ownerCookie, name);
  const businessId = ids.newId();
  await f.h.owner`INSERT INTO businesses (company_id,id,name_en,vertical_type)
    VALUES (${companyId},${businessId},'Admission business','salon')`;
  const branchId = ids.newId();
  await f.h.owner`INSERT INTO branches (company_id,id,business_id,name_en)
    VALUES (${companyId},${branchId},${businessId},'Admission branch')`;
  const employeeId = ids.newId();
  await f.h.owner`INSERT INTO employees (company_id,id,business_id,primary_branch_id,name_en,name_en_key,
      role_code,hire_date,employee_number)
    VALUES (${companyId},${employeeId},${businessId},${branchId},${name},${name.toLowerCase()},
      'staff','2026-01-01',${employeeNumber})`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES (${companyId},${ids.newId()},${businessId},${employeeId},${branchId},'2026-01-01')`;
  return { companyId, businessId, employeeId };
}

/** طلب منح عبر HTTP لشركة معيّنة — نفس جسم طلب الـ fixture لكن بمعرّفات الشركة. */
const grantFor = (company: Company, phone: string) =>
  f.h.send(
    'POST',
    `/v1/businesses/${company.businessId}/employees/${company.employeeId}/staff-access`,
    {
      cookie: f.ownerCookie,
      company: company.companyId,
      body: { phone, phone_confirmed: true, role: 'staff', pin: '1234' },
    },
  );

it('AC-ACT-1 a second grant for the same company is refused with 409 TRANSACTION_RETRY_REQUIRED and opens no tenant transaction', async () => {
  const first = await addEmployee(f, 'Admission first', f.salmiya, 910);
  const second = await addEmployee(f, 'Admission second', f.salmiya, 911);
  const gate = barrier();
  const real = f.h.auth.staffUsers.provision;
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockImplementation(async (input) => {
    await gate.arrive();
    return real(input);
  });
  try {
    const running = grant(f, first, nextPhone(f));
    await gate.entered;
    const before = tenantTransactions;
    const refused = await grant(f, second, nextPhone(f));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'TRANSACTION_RETRY_REQUIRED' });
    // الطلب المرفوض ما فتحش معاملة شركة ولا اتصال auth — الردّ اتقفل قبل أي شغل.
    expect(tenantTransactions).toBe(before);
    gate.release();
    expect((await running).status).toBe(200);
  } finally {
    gate.release();
    vi.restoreAllMocks();
  }
});

it('AC-ACT-1 the fifth concurrent grant across five companies is refused with 409 TRANSACTION_RETRY_REQUIRED', async () => {
  const companies: Company[] = [];
  for (let index = 0; index < 5; index += 1) {
    companies.push(await companyWithEmployee(`Admission company ${index}`, 920 + index));
  }
  const gate = barrier(4);
  const real = f.h.auth.staffUsers.provision;
  const blocked = new Set(companies.slice(0, 4).map((company) => company.companyId));
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockImplementation(async (input) => {
    if (blocked.has(input.companyId)) await gate.arrive();
    return real(input);
  });
  const fifth = companies[4];
  if (fifth === undefined) throw new Error('COMPANY_MISSING');
  try {
    const running = companies.slice(0, 4).map((company) => grantFor(company, nextPhone(f)));
    await gate.entered;
    const before = tenantTransactions;
    const refused = await grantFor(fifth, nextPhone(f));
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ code: 'TRANSACTION_RETRY_REQUIRED' });
    expect(tenantTransactions).toBe(before);
    gate.release();
    const outcomes = await Promise.all(running);
    expect(outcomes.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    // بعد ما الحصة اتفتحت تاني، الطلب اللي اترفض بيرجع ينجح.
    expect((await grantFor(fifth, nextPhone(f))).status).toBe(200);
  } finally {
    gate.release();
    vi.restoreAllMocks();
  }
});

it('AC-ACT-1 a 403 refusal releases the company slot for the next grant', async () => {
  const employee = await addEmployee(f, 'Admission refused', f.hawalli, 930);
  const refused = await grant(f, employee, nextPhone(f), f.managerCookie);
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect((await grant(f, employee, nextPhone(f))).status).toBe(200);
});

it('AC-ACT-1 a 409 refusal releases the company slot for the next grant', async () => {
  const employee = await addEmployee(f, 'Admission repeated', f.salmiya, 931);
  const phone = nextPhone(f);
  expect((await grant(f, employee, phone)).status).toBe(200);
  const repeated = await grant(f, employee, phone);
  expect(repeated.status).toBe(409);
  expect(repeated.body).toMatchObject({ code: 'STAFF_ACCESS_ALREADY_GRANTED' });
  const other = await addEmployee(f, 'Admission after repeat', f.salmiya, 932);
  expect((await grant(f, other, nextPhone(f))).status).toBe(200);
});

it('AC-ACT-1 a failed grant releases the company slot for the next grant', async () => {
  const employee = await addEmployee(f, 'Admission crashed', f.salmiya, 933);
  const phone = nextPhone(f);
  const real = f.h.auth.staffUsers.provision;
  vi.spyOn(f.h.auth.staffUsers, 'provision').mockImplementationOnce(async (input) => {
    await real(input);
    throw new Error('INJECTED_ADMISSION_CRASH');
  });
  try {
    expect((await grant(f, employee, phone)).status).toBe(500);
  } finally {
    vi.restoreAllMocks();
  }
  expect((await grant(f, employee, phone)).status).toBe(200);
});
