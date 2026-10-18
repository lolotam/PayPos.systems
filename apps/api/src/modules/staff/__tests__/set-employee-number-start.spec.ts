import { employeeNumbering } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  executeCreate,
  insertHeldNumbers,
  provisionEmployer,
  readCounter,
  setCounter,
} from './employee-number-assign.fixture.ts';
import {
  ALREADY_SET,
  counterOf,
  getNumbering,
  numberFixture,
  numbersOf,
  putStart,
  startAudits,
  type EmployeeFixture,
} from './set-employee-number-start.fixture.ts';

let f: EmployeeFixture;
beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('EN-11 keeps 1, 2 and 3, then assigns 1000 to the next employee', async () => {
  const employer = await provisionEmployer(f, 'EN-11 forward');
  await insertHeldNumbers(f, 1, 3, employer);
  await setCounter(f, 4, employer.companyId);
  const set = await putStart(f, { start_number: 1000 }, { company: employer.companyId });
  expect(set.status).toBe(200);
  expect(employeeNumbering.parse(set.body)).toMatchObject({
    next_number: 1000,
    start_number: 1000,
    can_manage: false,
  });
  expect(await numbersOf(f, employer.companyId)).toEqual([1, 2, 3]);
  const created = await executeCreate(f, 'EN-11 next', employer);
  expect(created.employee_number).toBe(1000);
  expect(await numbersOf(f, employer.companyId)).toEqual([1, 2, 3, 1000]);
  expect(await startAudits(f, employer.companyId)).toEqual([
    {
      entity_id: employer.companyId,
      actor_user_id: f.userId,
      before: { start_number: null, next_number: 4 },
      after: { start_number: 1000, next_number: 1000 },
    },
  ]);
});

it('EN-11 gives the first employee of an empty company the chosen start', async () => {
  const employer = await provisionEmployer(f, 'EN-11 empty');
  const before = await getNumbering(f, { company: employer.companyId });
  expect(employeeNumbering.parse(before.body)).toEqual({
    next_number: 1,
    start_number: null,
    start_set_at: null,
    can_manage: true,
  });
  expect((await putStart(f, { start_number: 1000 }, { company: employer.companyId })).status).toBe(200);
  const created = await executeCreate(f, 'EN-11 first', employer);
  expect(created.employee_number).toBe(1000);
});

it('EN-11 rejects a second start and leaves the row and the audit alone', async () => {
  const employer = await provisionEmployer(f, 'EN-11 once');
  expect((await putStart(f, { start_number: 1000 }, { company: employer.companyId })).status).toBe(200);
  const before = await counterOf(f, employer.companyId);
  const second = await putStart(f, { start_number: 2000 }, { company: employer.companyId });
  expect(second.status).toBe(409);
  expect(second.body).toMatchObject(ALREADY_SET);
  expect(await counterOf(f, employer.companyId)).toEqual(before);
  expect(await startAudits(f, employer.companyId)).toHaveLength(1);
});

it('EN-11 records a start below the counter without lowering it', async () => {
  const employer = await provisionEmployer(f, 'EN-11 lower');
  await setCounter(f, 4, employer.companyId);
  const set = await putStart(f, { start_number: 2 }, { company: employer.companyId });
  expect(employeeNumbering.parse(set.body)).toMatchObject({ next_number: 4, start_number: 2, can_manage: false });
  const created = await executeCreate(f, 'EN-11 stays', employer);
  expect(created.employee_number).toBe(4);
});

it('EN-11 numbers from 1 when no start was chosen', async () => {
  const employer = await provisionEmployer(f, 'EN-11 default');
  const created = await executeCreate(f, 'EN-11 one', employer);
  expect(created.employee_number).toBe(1);
  const view = await getNumbering(f, { company: employer.companyId });
  expect(employeeNumbering.parse(view.body)).toMatchObject({
    next_number: 2,
    start_number: null,
    start_set_at: null,
    can_manage: true,
  });
});

it('rejects a start outside 1..999999 and unknown keys', async () => {
  const companyId = await f.h.onboard(f.ownerCookie, 'EN-11 body');
  for (const body of [{ start_number: 0 }, { start_number: 1_000_000 }, { start_number: 1.5 }, { start_number: 3, extra: true }]) {
    expect((await putStart(f, body, { cookie: f.ownerCookie, company: companyId })).status).toBe(400);
  }
  expect(await readCounter(f, companyId)).toBeNull();
});
