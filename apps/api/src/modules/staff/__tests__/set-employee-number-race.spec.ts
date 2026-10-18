import { afterAll, beforeAll, expect, it } from 'vitest';
import { executeCreate, readCounter, setCounter, type EmployeeFixture } from './employee-number-assign.fixture.ts';
import { numberFixture, putNumber } from './set-employee-number.fixture.ts';

let f: EmployeeFixture;
beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('two concurrent edits to the same number yield one success and one conflict without moving the counter', async () => {
  await setCounter(f, 40_000);
  const first = await executeCreate(f, 'race first');
  const second = await executeCreate(f, 'race second');
  expect([first.employee_number, second.employee_number].sort()).toEqual([40_000, 40_001]);
  await setCounter(f, 40_000);
  const [left, right] = await Promise.all([
    putNumber(f, first.id, { employee_number: 70_000 }, { cookie: f.ownerCookie }),
    putNumber(f, second.id, { employee_number: 70_000 }, { cookie: f.ownerCookie }),
  ]);
  expect([left.status, right.status].sort()).toEqual([200, 409]);
  expect((left.status === 409 ? left : right).body['code']).toBe('EMPLOYEE_NUMBER_TAKEN');
  expect(await readCounter(f)).toBe(40_000);
});

it('an edit to the counter value racing a create does not store the number twice', async () => {
  const employee = await executeCreate(f, 'race edit');
  await setCounter(f, 80_000);
  const [edited, created] = await Promise.all([
    putNumber(f, employee.id, { employee_number: 80_000 }, { cookie: f.ownerCookie }),
    executeCreate(f, 'race create'),
  ]);
  const holders = await f.h.owner`SELECT id FROM employees WHERE company_id=${f.company} AND employee_number=80000`;
  expect(holders).toHaveLength(1);
  if (edited.status === 200) expect(created.employee_number).not.toBe(80_000);
  else {
    expect(edited.status).toBe(409);
    expect(edited.body['code']).toBe('EMPLOYEE_NUMBER_TAKEN');
    expect(created.employee_number).toBe(80_000);
  }
});
