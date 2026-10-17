import { afterAll, beforeAll, expect, it } from 'vitest';

import { CreateEmployeeUseCase } from '../use-cases/create-employee/create-employee.usecase.ts';
import {
  allocationsSharingTheCounterLock,
  assignFixture,
  employeeNumberIds,
  employeeUserMembership,
  executeCreate,
  firstSequenceSeedRace,
  grantEmployeeCreation,
  provisionEmployer,
  readCounter,
  setCounter,
  termsFor,
  type EmployeeFixture,
} from './employee-number-assign.fixture.ts';

let f: EmployeeFixture;
beforeAll(async () => {
  f = await assignFixture();
  await grantEmployeeCreation(f);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const ascending = (numbers: number[]) => [...numbers].sort((left, right) => left - right);

it('EN-04 concurrent creates in one company are distinct and gap-free', async () => {
  await setCounter(f, 3000);
  const pair = await Promise.all([
    executeCreate(f, 'Concurrent A'),
    executeCreate(f, 'Concurrent B'),
  ]);
  expect(ascending(pair.map((record) => record.employee_number ?? 0))).toEqual([3000, 3001]);
  await setCounter(f, 4000);
  const many = await Promise.all(
    Array.from({ length: 20 }, (_, index) => executeCreate(f, `Concurrent ${index}`)),
  );
  expect(ascending(many.map((record) => record.employee_number ?? 0))).toEqual(
    Array.from({ length: 20 }, (_, index) => 4000 + index),
  );
  expect(await readCounter(f)).toBe(4020);
}, 60_000);

it('the allocator lock alone keeps concurrent numbers distinct', async () => {
  await setCounter(f, 5000);
  const numbers = await allocationsSharingTheCounterLock(f, f.company);
  expect(ascending(numbers)).toEqual([5000, 5001]);
  expect(await readCounter(f)).toBe(5002);
});

it('a held first seed gives 1 then 2, and rolling it back lets the waiter take 1', async () => {
  const committed = await provisionEmployer(f, 'Seed commit');
  expect(await firstSequenceSeedRace(f, committed.companyId, 'commit')).toEqual({
    first: 1,
    second: 2,
  });
  const rolled = await provisionEmployer(f, 'Seed rollback');
  expect(await firstSequenceSeedRace(f, rolled.companyId, 'rollback')).toEqual({
    first: null,
    second: 1,
  });
  expect(await readCounter(f, rolled.companyId)).toBe(2);
});

it('EN-05 a wrong branch or a refused user link leaves the counter untouched', async () => {
  await setCounter(f, 6100);
  await expect(
    executeCreate(f, 'Wrong branch', { primary_branch_id: f.foreignBranch }),
  ).rejects.toThrow('EMPLOYEE_BRANCH_NOT_FOUND');
  expect(await readCounter(f)).toBe(6100);
  await setCounter(f, 6200);
  await expect(
    executeCreate(f, 'Unknown user', { user_id: employeeNumberIds.newId() }),
  ).rejects.toThrow('EMPLOYEE_USER_LINK_UNAVAILABLE');
  expect(await readCounter(f)).toBe(6200);
});

it('EN-05 a failure after allocation rolls the counter back', async () => {
  await setCounter(f, 6300);
  const failing = new CreateEmployeeUseCase(
    {
      run: (actor, work) =>
        f.transactions.run(actor, (scope) =>
          work({
            ...scope,
            audit: async () => {
              throw new Error('synthetic audit failure');
            },
          }),
        ),
    },
    employeeNumberIds,
    { now: () => new Date('2026-10-17T00:00:00Z') },
  );
  await expect(
    failing.execute({
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      input: termsFor(f, 'Audit rolls back'),
    }),
  ).rejects.toThrow('EMPLOYEE_PERSISTENCE_FAILED');
  expect(await readCounter(f)).toBe(6300);
  expect(await f.h.owner`SELECT 1 FROM employees WHERE name_en='Audit rolls back'`).toHaveLength(0);
  await setCounter(f, 6400);
  const userId = employeeNumberIds.newId();
  await f.h
    .owner`INSERT INTO "user"(id,name,email) VALUES (${userId},'Synthetic link',${`race-${userId}@example.test`})`;
  await employeeUserMembership(f, userId);
  const results = await Promise.allSettled([
    executeCreate(f, 'Race A', { user_id: userId }),
    executeCreate(f, 'Race B', { user_id: userId }),
  ]);
  const won = results.find((result) => result.status === 'fulfilled');
  const lost = results.find((result) => result.status === 'rejected');
  expect(won?.status === 'fulfilled' ? won.value.employee_number : null).toBe(6400);
  expect(lost?.status === 'rejected' ? (lost.reason as Error).message : null).toBe(
    'EMPLOYEE_USER_ALREADY_LINKED',
  );
  expect(await readCounter(f)).toBe(6401);
});
