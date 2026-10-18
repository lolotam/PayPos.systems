import { employeeNumberView } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readCounter, setCounter, insertHeldNumbers, type EmployeeFixture } from './employee-number-assign.fixture.ts';
import {
  attachBranch,
  clearNumberGrants,
  executeCreate,
  grantNumber,
  numberAudits,
  numberDevice,
  numberFixture,
  putNumber,
} from './set-employee-number.fixture.ts';

const TAKEN_AR = 'الرقم الوظيفي مستخدم بالفعل لموظف آخر في الشركة.';
const TAKEN_EN = 'This employee number is already used by another employee in the company.';
let f: EmployeeFixture;

beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('EN-06 leaves the counter unchanged and a later assignment skips the hand-set number', async () => {
  const employee = await executeCreate(f, 'EN-06');
  await setCounter(f, 40_000);
  expect((await putNumber(f, employee.id, { employee_number: 50_000 }, { cookie: f.ownerCookie })).status).toBe(200);
  expect(await readCounter(f)).toBe(40_000);
  expect((await executeCreate(f, 'EN-06 next')).employee_number).toBe(40_000);
  expect(await readCounter(f)).toBe(40_001);
  await setCounter(f, 50_000);
  expect((await executeCreate(f, 'EN-06 skip')).employee_number).toBe(50_001);
  expect(await readCounter(f)).toBe(50_002);
});

it('EN-07 rejects a number held by an active employee and by a soft-deleted one', async () => {
  const employee = await executeCreate(f, 'EN-07');
  await insertHeldNumbers(f, 60_000, 1);
  const active = await putNumber(f, employee.id, { employee_number: 60_000 }, { cookie: f.ownerCookie });
  expect(active.status).toBe(409);
  expect(active.body).toMatchObject({ code: 'EMPLOYEE_NUMBER_TAKEN', message_ar: TAKEN_AR, message_en: TAKEN_EN });
  await insertHeldNumbers(f, 60_001, 1, { deleted: true });
  const deleted = await putNumber(f, employee.id, { employee_number: 60_001 }, { cookie: f.ownerCookie });
  expect(deleted.status).toBe(409);
  expect(deleted.body['code']).toBe('EMPLOYEE_NUMBER_TAKEN');
});

it('EN-08 rejects out-of-range, fractional, textual and extra-key bodies', async () => {
  const employeeId = '01900000-0000-7000-8000-000000000099';
  for (const body of [0, 1_000_000, -1, 1.5, '007']) {
    expect((await putNumber(f, employeeId, { employee_number: body }, { cookie: f.ownerCookie })).status).toBe(400);
  }
  expect((await putNumber(f, employeeId, { employee_number: 12, extra: true }, { cookie: f.ownerCookie })).status).toBe(400);
});

it('EN-09 allows the owner and a company grant, and refuses a non-holder and a device', async () => {
  const employee = await executeCreate(f, 'EN-09');
  expect((await putNumber(f, employee.id, { employee_number: 1101 })).status).toBe(403);
  const owner = await putNumber(f, employee.id, { employee_number: 1101 }, { cookie: f.ownerCookie });
  expect(owner.status).toBe(200);
  expect(employeeNumberView.parse(owner.body)).toEqual({ employee_id: employee.id, employee_number: 1101 });
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  try {
    expect((await putNumber(f, employee.id, { employee_number: 1102 })).status).toBe(200);
  } finally {
    await clearNumberGrants(f);
  }
  const token = await numberDevice(f);
  const device = await f.h.app.inject({
    method: 'PUT',
    url: `/v1/businesses/${f.business}/employees/${employee.id}/employee-number`,
    payload: { employee_number: 1103 },
    headers: { authorization: `Device ${token}`, 'x-company-id': f.company, origin: 'http://admin.test' },
  });
  expect(device.statusCode).toBe(403);
});

it('EN-10 returns the same number without an audit and audits one real change', async () => {
  const employee = await executeCreate(f, 'EN-10');
  const same = await putNumber(f, employee.id, { employee_number: employee.employee_number }, { cookie: f.ownerCookie });
  expect(same.status).toBe(200);
  expect(await numberAudits(f, employee.id)).toEqual([]);
  const changed = await putNumber(f, employee.id, { employee_number: 90_000 }, { cookie: f.ownerCookie });
  expect(changed.status).toBe(200);
  expect(await numberAudits(f, employee.id)).toEqual([
    { before: { employee_number: employee.employee_number }, after: { employee_number: 90_000 } },
  ]);
});

it('D-5 hides a deleted employee and an employee addressed through another business', async () => {
  const deletedEmployee = await executeCreate(f, 'D-5 deleted');
  await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${deletedEmployee.id}`;
  const deleted = await putNumber(f, deletedEmployee.id, { employee_number: 1200 }, { cookie: f.ownerCookie });
  expect(deleted.status).toBe(404);
  expect(deleted.body['code']).toBe('NOT_FOUND');
  const live = await executeCreate(f, 'D-5 live');
  const wrong = await putNumber(f, live.id, { employee_number: 1201 }, { cookie: f.ownerCookie, businessId: f.secondBusiness });
  expect(wrong.status).toBe(404);
  expect(wrong.body['code']).toBe('NOT_FOUND');
});

it('a DENY on the employee business blocks her and still allows the same holder in another business', async () => {
  const blocked = await executeCreate(f, 'DENY business');
  const allowed = await executeCreate(f, 'DENY other business', { businessId: f.secondBusiness, branchId: f.otherBranch });
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  await grantNumber(f, 'DENY', 'BUSINESS', f.business);
  try {
    expect((await putNumber(f, blocked.id, { employee_number: 1300 })).body['code']).toBe('FORBIDDEN');
    const other = await putNumber(f, allowed.id, { employee_number: 1301 }, { businessId: f.secondBusiness });
    expect(other.status).toBe(200);
  } finally {
    await clearNumberGrants(f);
  }
});

it('a DENY on the primary branch blocks the edit', async () => {
  const employee = await executeCreate(f, 'DENY primary');
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  await grantNumber(f, 'DENY', 'BRANCH', f.branch);
  try {
    expect((await putNumber(f, employee.id, { employee_number: 1400 })).status).toBe(403);
  } finally {
    await clearNumberGrants(f);
  }
});

it('a DENY on another attached branch blocks the edit', async () => {
  const employee = await executeCreate(f, 'DENY attached');
  const extra = await attachBranch(f, employee.id);
  await grantNumber(f, 'ALLOW', 'COMPANY', f.company);
  await grantNumber(f, 'DENY', 'BRANCH', extra);
  try {
    expect((await putNumber(f, employee.id, { employee_number: 1500 })).status).toBe(403);
  } finally {
    await clearNumberGrants(f);
  }
});
