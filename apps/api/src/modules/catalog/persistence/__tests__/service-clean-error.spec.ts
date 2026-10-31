import { IdempotencyKeyBusyError, type TenantWrappers, type Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { expect, it } from 'vitest';

import { ServiceError } from '../../domain/errors.ts';
import { createServiceTransactions } from '../drizzle-service-transactions.ts';

const ids = systemUuidV7();
const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const USER = '01920000-0000-7000-8000-0000000000f1';

/**
 * غلاف قاعدة بيانات ينفّذ callback المعاملة من غير كتابة، لأن تنظيف أخطاء الخدمة جوه
 * المعاملة نفسها — رفض الغلاف من بره كان هيعدّي التنظيف وما يثبتش السلوك.
 */
function failingDatabase(): TenantWrappers {
  const refused = (): Promise<never> => Promise.reject(new Error('the wrapper must not be called'));
  return {
    withTenant: (_companyId: string, work: (tx: Tx) => Promise<unknown>) => work({} as Tx),
    withUser: refused,
    withNewTenant: refused,
  } as unknown as TenantWrappers;
}

/** يشغّل معاملة خدمة على غلاف يفشل بالخطأ المعطى، فيمرّ الخطأ عبر تنظيف الأخطاء. */
function runWith(failure: unknown): Promise<unknown> {
  const transactions = createServiceTransactions(failingDatabase(), ids);
  return transactions.run({ companyId: COMPANY, userId: USER }, async () => {
    throw failure;
  });
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
    constraint_name: 'services_other_uq',
  });
  const failure = new Error('Failed query', { cause });
  await expect(runWith(failure)).rejects.toBe(failure);
  await expect(runWith(failure)).rejects.toThrow('Failed query');
});

it('the named mappings of the constraints it knows still answer', async () => {
  const nameInvalid = Object.assign(new Error('check violation'), {
    code: '23514',
    constraint_name: 'services_name_en_length',
  });
  const ruleInvalid = Object.assign(new Error('check violation'), {
    code: '23514',
    constraint_name: 'services_rule_kind',
  });
  const priceInvalid = Object.assign(new Error('numeric field overflow'), { code: '22003' });
  const missing = Object.assign(new Error('foreign key violation'), { code: '23503' });
  const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
  const conflict = new ServiceError('SERVICE_REVISION_CONFLICT');
  await expect(runWith(nameInvalid)).rejects.toThrow('SERVICE_NAME_INVALID');
  await expect(runWith(ruleInvalid)).rejects.toThrow('SERVICE_COMMISSION_RULE_INVALID');
  await expect(runWith(priceInvalid)).rejects.toThrow('SERVICE_PRICE_INVALID');
  await expect(runWith(missing)).rejects.toThrow('SERVICE_NOT_FOUND');
  await expect(runWith(deadlock)).rejects.toThrow('TRANSACTION_RETRY_REQUIRED');
  await expect(runWith(conflict)).rejects.toThrow('SERVICE_REVISION_CONFLICT');
});
