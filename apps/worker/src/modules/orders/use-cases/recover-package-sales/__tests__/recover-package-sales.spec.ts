import { expect, it } from 'vitest';
import type { PackageSaleRecoveryTransactions } from '../../../ports/package-sale-recovery.port.ts';
import { RecoverPackageSales } from '../recover-package-sales.ts';
import { PACKAGE_SALE_RECOVERY_MAX_PAGES } from '../../../domain/package-sale-recovery.ts';

const NOW = new Date('2026-11-05T12:00:00.000Z');
const BEFORE = '2026-11-05T11:50:00.000Z';

type Read = { companyId: string; before: Date };
type Closed = { requestId: string; before: Date; at: string };

/** قراءات متتالية جاهزة، كل قراءة بترجع الدفعة اللي بعدها وبس. */
function fakeTransactions(batches: readonly (readonly string[])[]) {
  const pending = [...batches];
  const reads: Read[] = [];
  const closed: Closed[] = [];
  const transactions: PackageSaleRecoveryTransactions = {
    candidates: async (companyId, before) => {
      reads.push({ companyId, before });
      return pending.shift() ?? [];
    },
    failStale: async (_companyId, requestId, before, at) => {
      closed.push({ requestId, before, at });
    },
  };
  return { transactions, reads, closed };
}

function recovery(transactions: PackageSaleRecoveryTransactions) {
  return new RecoverPackageSales(transactions, { now: () => NOW });
}

it('closes every stale request and keeps reading until a read comes back empty', async () => {
  const f = fakeTransactions([['first', 'second'], ['third'], []]);
  await recovery(f.transactions).execute('01920000-0000-7000-8000-0000000000a0');
  expect(f.closed.map((entry) => entry.requestId)).toEqual(['first', 'second', 'third']);
  expect(f.reads).toHaveLength(3);
  expect(f.reads.every((read) => read.companyId === '01920000-0000-7000-8000-0000000000a0')).toBe(
    true,
  );
});

it('closes each candidate with the boundary and the instant of the injected clock', async () => {
  const f = fakeTransactions([['first'], []]);
  await recovery(f.transactions).execute('01920000-0000-7000-8000-0000000000a0');
  expect(f.closed).toHaveLength(1);
  expect(f.closed[0]?.before.toISOString()).toBe(BEFORE);
  expect(f.closed[0]?.at).toBe('2026-11-05T12:00:00.000Z');
  expect(f.reads[0]?.before.toISOString()).toBe(BEFORE);
});

it('stops the sweep after the first empty read', async () => {
  const f = fakeTransactions([[]]);
  await recovery(f.transactions).execute('01920000-0000-7000-8000-0000000000a0');
  expect(f.reads).toHaveLength(1);
  expect(f.closed).toHaveLength(0);
});

it('propagates a failing close and stops the sweep there', async () => {
  const f = fakeTransactions([['first'], ['second'], []]);
  let closes = 0;
  const failing: PackageSaleRecoveryTransactions = {
    ...f.transactions,
    failStale: async () => {
      closes += 1;
      throw new Error('PACKAGE_SALE_RECOVERY_CLOSE_FAILED');
    },
  };
  await expect(recovery(failing).execute('01920000-0000-7000-8000-0000000000a0')).rejects.toThrow(
    'PACKAGE_SALE_RECOVERY_CLOSE_FAILED',
  );
  expect(closes).toBe(1);
  expect(f.reads).toHaveLength(1);
});

it('stops after the page cap when every read keeps returning candidates', async () => {
  const endless = Array.from({ length: PACKAGE_SALE_RECOVERY_MAX_PAGES + 5 }, (_, page) => [
    `request-${page}`,
  ]);
  const { transactions, reads, closed } = fakeTransactions(endless);
  await recovery(transactions).execute('company');
  expect(reads).toHaveLength(PACKAGE_SALE_RECOVERY_MAX_PAGES);
  expect(closed).toHaveLength(PACKAGE_SALE_RECOVERY_MAX_PAGES);
});
