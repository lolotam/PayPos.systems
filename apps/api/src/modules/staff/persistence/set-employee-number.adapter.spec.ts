import type { TenantWrappers } from '@pospay/db';
import { expect, it } from 'vitest';
import { SetEmployeeNumberError } from '../domain/employee-number-change.ts';
import { createSetEmployeeNumberTransactions } from './set-employee-number.adapter.ts';

const actor = { companyId: 'company', userId: 'user' };

function rejectingDatabase(error: unknown): TenantWrappers {
  return {
    withTenant: () => Promise.reject(error),
    withUser: () => Promise.reject(error),
    withNewTenant: () => Promise.reject(error),
  };
}

it('maps 40001, 40P01 and 55P03 through run to TRANSACTION_RETRY_REQUIRED', async () => {
  const ids = { newId: () => 'id' };
  for (const code of ['40001', '40P01', '55P03']) {
    const transactions = createSetEmployeeNumberTransactions(rejectingDatabase({ code }), ids);
    const error = await transactions.run(actor, async () => undefined).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SetEmployeeNumberError);
    expect(error).toMatchObject({ code: 'TRANSACTION_RETRY_REQUIRED' });
  }
});
