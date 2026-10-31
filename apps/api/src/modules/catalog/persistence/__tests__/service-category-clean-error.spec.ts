import { IdempotencyKeyBusyError, type TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';

import { ServiceCategoryError } from '../../domain/errors.ts';
import { createServiceCategoryTransactions } from '../drizzle-service-category-transactions.ts';

const ids = systemUuidV7();
const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const USER = '01920000-0000-7000-8000-0000000000f1';

/** غلاف قاعدة بيانات يرمي الخطأ المعطى قبل أي كتابة، فيصل الخطأ إلى تنظيف الأخطاء بلا اتصال بقاعدة. */
function failingDatabase(failure: unknown): TenantWrappers {
  const refused = (): Promise<never> => Promise.reject(new Error('the wrapper must not be called'));
  return {
    withTenant: () => Promise.reject(failure),
    withUser: refused,
    withNewTenant: refused,
  } as unknown as TenantWrappers;
}

/** يشغّل معاملة تصنيف على غلاف يفشل بالخطأ المعطى، فيمرّ الخطأ عبر تنظيف الأخطاء. */
function runWith(failure: unknown): Promise<unknown> {
  const transactions = createServiceCategoryTransactions(failingDatabase(failure), ids);
  return transactions.run({ companyId: COMPANY, userId: USER }, async () => undefined);
}

it('an unrecognised error reaches the caller unchanged instead of a generic one', async () => {
  const failure = new Error('connection terminated unexpectedly');
  await expect(runWith(failure)).rejects.toBe(failure);
  await expect(runWith(failure)).rejects.toThrow('connection terminated unexpectedly');
});

it('a wrapped driver error keeps the error and the cause the driver reported', async () => {
  const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: 'service_categories_other_uq',
  });
  const failure = new Error('Failed query', { cause });
  await expect(runWith(failure)).rejects.toBe(failure);
  await expect(runWith(failure)).rejects.toThrow('Failed query');
});

it('a typed infrastructure error keeps the identity the API filter maps', async () => {
  const failure = new IdempotencyKeyBusyError();
  const rejection = await runWith(failure).catch((error: unknown) => error);
  expect(rejection).toBe(failure);
  expect(rejection).toBeInstanceOf(IdempotencyKeyBusyError);
});

it('the named mappings of the constraints it knows still answer', async () => {
  const nameTaken = Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint_name: 'service_categories_business_name_uq',
  });
  const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  const closed = new ServiceCategoryError('SERVICE_CATEGORY_CLOSED');
  await expect(runWith(nameTaken)).rejects.toThrow('SERVICE_CATEGORY_NAME_TAKEN');
  await expect(runWith(deadlock)).rejects.toThrow('TRANSACTION_RETRY_REQUIRED');
  await expect(runWith(closed)).rejects.toThrow('SERVICE_CATEGORY_CLOSED');
});
