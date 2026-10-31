import { IdempotencyKeyBusyError, type TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';

import { PackageTypeError } from '../../domain/errors.ts';
import { createPackageTypeTransactions } from '../drizzle-package-type-transactions.ts';

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

/** يشغّل معاملة نوع الباقة على غلاف يفشل بالخطأ المعطى، فيمرّ الخطأ عبر تنظيف الأخطاء. */
function runWith(failure: unknown): Promise<unknown> {
  const transactions = createPackageTypeTransactions(failingDatabase(failure), ids);
  return transactions.run({ companyId: COMPANY, userId: USER }, async () => undefined);
}

const PASS_THROUGH_CASES: [string, () => Error, new (...args: never[]) => Error][] = [
  ['an unrecognised driver error', () => new Error('connection terminated unexpectedly'), Error],
  ['a typed infrastructure error', () => new IdempotencyKeyBusyError(), IdempotencyKeyBusyError],
];

it.each(PASS_THROUGH_CASES)('%s passes through unchanged', async (_label, make, expected) => {
  const failure = make();
  const rejection = await runWith(failure).catch((error: unknown) => error);
  expect(rejection).toBe(failure);
  expect(rejection).toBeInstanceOf(expected);
});

it('a wrapped driver error keeps the error and the cause the driver reported', async () => {
  const cause = Object.assign(new Error('duplicate key value violates unique constraint'), {
    code: '23505',
    constraint_name: 'package_types_other_uq',
  });
  const failure = new Error('Failed query', { cause });
  await expect(runWith(failure)).rejects.toBe(failure);
  await expect(runWith(failure)).rejects.toThrow('Failed query');
});

it('the named mappings of the constraints it knows still answer', async () => {
  const nameTaken = Object.assign(new Error('duplicate key'), {
    code: '23505',
    constraint_name: 'package_types_name_en_key',
  });
  const serviceMissing = Object.assign(new Error('foreign key violation'), {
    code: '23503',
    constraint_name: 'package_type_components_service_fk',
  });
  const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  const nameInvalid = Object.assign(new Error('check violation'), {
    code: '23514',
    constraint_name: 'package_types_name_en_length',
  });
  const conflict = new PackageTypeError('PACKAGE_TYPE_REVISION_CONFLICT');
  await expect(runWith(nameTaken)).rejects.toThrow('PACKAGE_TYPE_NAME_TAKEN');
  await expect(runWith(serviceMissing)).rejects.toThrow('PACKAGE_TYPE_SERVICE_NOT_FOUND');
  await expect(runWith(deadlock)).rejects.toThrow('TRANSACTION_RETRY_REQUIRED');
  await expect(runWith(nameInvalid)).rejects.toThrow('PACKAGE_TYPE_NAME_INVALID');
  await expect(runWith(conflict)).rejects.toThrow('PACKAGE_TYPE_REVISION_CONFLICT');
});
