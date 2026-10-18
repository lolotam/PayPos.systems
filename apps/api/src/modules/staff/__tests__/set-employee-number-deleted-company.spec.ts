import { afterAll, beforeAll, expect, it } from 'vitest';
import { createSetEmployeeNumberTransactions } from '../persistence/set-employee-number.adapter.ts';
import { createSetEmployeeNumberStartTransactions } from '../persistence/set-employee-number-start.adapter.ts';
import { SetEmployeeNumberUseCase } from '../use-cases/set-employee-number/set-employee-number.usecase.ts';
import { SetEmployeeNumberStartUseCase } from '../use-cases/set-employee-number-start/set-employee-number-start.usecase.ts';
import { employeeNumberIds, executeCreate, provisionEmployer } from './employee-number-assign.fixture.ts';
import { counterOf, numberFixture, startAudits, type EmployeeFixture } from './set-employee-number-start.fixture.ts';

const clock = { now: () => new Date('2026-10-18T12:00:00.000Z') };

let f: EmployeeFixture;
beforeAll(async () => {
  f = await numberFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('refuses a start on a soft-deleted company and leaves the counter and audit', async () => {
  const employer = await provisionEmployer(f, 'deleted start');
  await executeCreate(f, 'deleted start employee', employer);
  const before = await counterOf(f, employer.companyId);
  await f.h.owner`UPDATE companies SET deleted_at=now() WHERE id=${employer.companyId}`;
  try {
    const useCase = new SetEmployeeNumberStartUseCase(
      createSetEmployeeNumberStartTransactions(f.db, employeeNumberIds),
      clock,
    );
    await expect(
      useCase.execute({ companyId: employer.companyId, userId: f.userId, startNumber: 80 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await counterOf(f, employer.companyId)).toEqual(before);
    expect(await startAudits(f, employer.companyId)).toEqual([]);
  } finally {
    await f.h.owner`UPDATE companies SET deleted_at=NULL WHERE id=${employer.companyId}`;
  }
});

it('refuses a hand edit on a soft-deleted company and leaves the number and audit', async () => {
  const employer = await provisionEmployer(f, 'deleted edit');
  const employee = await executeCreate(f, 'deleted edit employee', employer);
  const current = employee.employee_number;
  if (current === null) throw new Error('SYNTHETIC_NUMBER_MISSING');
  await f.h.owner`UPDATE companies SET deleted_at=now() WHERE id=${employer.companyId}`;
  try {
    const useCase = new SetEmployeeNumberUseCase(createSetEmployeeNumberTransactions(f.db, employeeNumberIds));
    await expect(
      useCase.execute({
        companyId: employer.companyId,
        userId: f.userId,
        businessId: employer.businessId,
        employeeId: employee.id,
        employeeNumber: current + 1,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const [stored] = await f.h.owner<{ employee_number: number | string }[]>`
      SELECT employee_number FROM employees WHERE company_id=${employer.companyId} AND id=${employee.id}`;
    expect(Number(stored?.employee_number)).toBe(current);
    const audits = await f.h.owner`
      SELECT id FROM audit_log
      WHERE company_id=${employer.companyId} AND action='employee_number.changed'`;
    expect(audits).toEqual([]);
  } finally {
    await f.h.owner`UPDATE companies SET deleted_at=NULL WHERE id=${employer.companyId}`;
  }
});
