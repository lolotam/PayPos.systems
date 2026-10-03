import { systemUuidV7 } from '@pospay/ids';
import { createSalaryTransactions } from '../persistence/drizzle-salary-transactions.ts';
import { SetSalaryUseCase } from '../use-cases/set-salary/set-salary.usecase.ts';
import { employeesFixture, grantEmployeeCreation, termsFor } from './employees.fixture.ts';
export const salaryIds = systemUuidV7();
export async function salaryFixture() {
  const f = await employeesFixture();
  await grantEmployeeCreation(f);
  const employee = await f.useCase.execute({
    companyId: f.company,
    userId: f.userId,
    businessId: f.business,
    input: termsFor(f),
  });
  const set = new SetSalaryUseCase(createSalaryTransactions(f.db, salaryIds), salaryIds);
  return {
    ...f,
    employee,
    set,
    context: {
      companyId: f.company,
      userId: f.userId,
      businessId: f.business,
      employeeId: employee.id,
    },
    path: `/v1/businesses/${f.business}/employees/${employee.id}/salaries`,
  };
}
export type SalaryFixture = Awaited<ReturnType<typeof salaryFixture>>;
export const salaryTerms = (amount = '100.000', date = '2026-01-01') => ({
  effective_from: date,
  amount,
  reason: 'Synthetic salary correction',
});
export const salaryCommand = (f: SalaryFixture, amount = '100.000', date = '2026-01-01') => ({
  ...f.context,
  input: salaryTerms(amount, date),
  key: salaryIds.newId(),
  fingerprint: 'a'.repeat(64),
});
