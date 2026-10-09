import { GCC_BANKS } from '@pospay/domain';
import type { SetEmployeeIbanInput } from '@pospay/contracts';
import { salaryFixture, salaryIds } from './salary.fixture.ts';
import { termsFor } from './employees.fixture.ts';
import { createEmployeeIbanTransactions } from '../persistence/drizzle-employee-iban-transactions.ts';
import { SetEmployeeIbanUseCase } from '../use-cases/set-employee-iban/set-employee-iban.usecase.ts';
export const ibanIds = salaryIds;
export const registryIban = 'KW81CBKU0000000000001234560101';
export function generatedIban(serial: number, country = 'KW', bban?: string) {
  const account = bban ?? `CBKU${String(serial).padStart(22, '0')}`;
  const digits = `${account}${country}00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return `${country}${String(98 - remainder).padStart(2, '0')}${account}`;
}
export const ibanTerms = (iban = registryIban, expected_revision = 0): SetEmployeeIbanInput => ({
  iban,
  bank_id: 'kw-cbk',
  holder_name_en: 'SYNTHETIC HOLDER',
  reason: 'Synthetic change',
  expected_revision,
});
export async function employeeIbanFixture() {
  const f = await salaryFixture();
  return {
    ...f,
    setIban: new SetEmployeeIbanUseCase(
      createEmployeeIbanTransactions(f.db, ibanIds),
      ibanIds,
      GCC_BANKS,
    ),
    ibanPath: `/v1/businesses/${f.business}/employees/${f.employee.id}/iban`,
  };
}
export type IbanFixture = Awaited<ReturnType<typeof employeeIbanFixture>>;
export async function newIbanEmployee(
  f: IbanFixture,
  businessId = f.business,
  companyId = f.company,
) {
  const employee = await f.useCase.execute({
    companyId,
    userId: f.userId,
    businessId,
    input: {
      ...termsFor(f, 'Synthetic IBAN employee'),
      primary_branch_id:
        companyId !== f.company
          ? f.foreignBranch
          : businessId === f.business
            ? f.branch
            : f.otherBranch,
    },
  });
  return { companyId, userId: f.userId, businessId, employeeId: employee.id };
}
export async function ibanHttp(
  f: IbanFixture,
  method: 'GET' | 'PUT',
  path = f.ibanPath,
  body?: object,
  company = f.company,
) {
  const response = await f.h.app.inject({
    method,
    url: path,
    headers: {
      cookie: f.cookie,
      'x-company-id': company,
      origin: 'http://admin.test',
    },
    ...(body === undefined ? {} : { payload: body }),
  });
  return {
    status: response.statusCode,
    body: response.json<Record<string, unknown>>(),
    text: response.body,
  };
}
