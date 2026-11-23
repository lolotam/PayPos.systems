import { IdempotencyKeyBusyError, type TenantWrappers, type Tx } from '@pospay/db';
import { expect, it } from 'vitest';

import { CommissionPlanVersionError } from '../domain/errors.ts';
import { refuseAfterBusyClaim } from '../persistence/refuse-after-busy-claim.ts';

const command = { companyId: 'company', userId: 'user' };
const busy = new IdempotencyKeyBusyError();

/** غلاف قاعدة بيشغّل الدالة بمعاملة وهمية ويسجّل الخيارات اللي اتبعتت، أو يرفض بخطأ جاهز. */
function fakeDatabase(outcome: { rejectWith?: Error }) {
  const seen: { options?: object | undefined } = {};
  const database = {
    withTenant: async (_company: string, work: (tx: Tx) => Promise<unknown>, options?: object) => {
      seen.options = options;
      if (outcome.rejectWith !== undefined) throw outcome.rejectWith;
      return work({} as Tx);
    },
  } as unknown as TenantWrappers;
  return { database, seen };
}

const failBusy = () => Promise.reject(busy);

it('rethrows the busy error unchanged when access is still granted', async () => {
  const { database } = fakeDatabase({});
  await expect(
    refuseAfterBusyClaim(database, command, failBusy, () => ({ recheckAccess: async () => null })),
  ).rejects.toBe(busy);
});

it('throws the access refusal instead of the busy error when access is no longer granted', async () => {
  const { database, seen } = fakeDatabase({});
  await expect(
    refuseAfterBusyClaim(database, command, failBusy, () => ({
      recheckAccess: async () => 'FORBIDDEN' as const,
    })),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(seen.options).toEqual({ userId: 'user', timeoutMs: 1_000 });
});

it('propagates a bounded timeout error of the access check, never the busy error', async () => {
  const timeout = Object.assign(new Error('transaction deadline passed'), { name: 'TimeoutError' });
  const { database } = fakeDatabase({ rejectWith: timeout });
  const outcome = refuseAfterBusyClaim(database, command, failBusy, () => ({
    recheckAccess: async () => null,
  }));
  await expect(outcome).rejects.toBe(timeout);
  await expect(outcome).rejects.not.toBeInstanceOf(CommissionPlanVersionError);
});
