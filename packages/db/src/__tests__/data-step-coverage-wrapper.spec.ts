import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../client.ts';
import type { IdGenerator, Tx } from '../with-tenant.ts';
import { invalidateCoverageInTenant } from '../data-steps/coverage.ts';

// وحدة الإبطال لخطوة معلنة INVALIDATES: كل withTenant يبدأ بجملة invalidate_commission_coverage
// على معاملة الخطوة نفسها ثم شغل الخطوة، وكل معاملة بمعرّف حالة جديد. الاختبار بدون قاعدة بيانات.

const IDS: IdGenerator = {
  newId: vi
    .fn<IdGenerator['newId']>()
    .mockReturnValueOnce('0195a7c0-0000-7000-8000-000000000001')
    .mockReturnValueOnce('0195a7c0-0000-7000-8000-000000000002'),
};

function fakeDatabase(orders: string[]): Database {
  return {
    withTenant: vi.fn(async (_companyId: string, work: (tx: Tx) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async () => {
          orders.push('invalidate');
          return undefined;
        }),
      } as unknown as Tx;
      return work(tx);
    }),
  } as unknown as Database;
}

describe('invalidateCoverageInTenant', () => {
  it('invalidates coverage inside the tenant transaction before the step work, once per transaction', async () => {
    const orders: string[] = [];
    const app = fakeDatabase(orders);
    const wrapped = invalidateCoverageInTenant(app, IDS);
    const result = await wrapped.withTenant('c1', async (tx) => {
      orders.push('work');
      expect(tx.execute).toHaveBeenCalledTimes(1);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(orders).toEqual(['invalidate', 'work']);
  });

  it('takes a fresh state id for every transaction and forwards the same tenant and options', async () => {
    const app = fakeDatabase([]);
    const withTenant = vi.mocked(app.withTenant);
    const wrapped = invalidateCoverageInTenant(app, IDS);
    await wrapped.withTenant('c1', async () => undefined);
    await wrapped.withTenant('c2', async () => undefined, { timeoutMs: 1234 });
    expect(withTenant).toHaveBeenCalledTimes(2);
    expect(withTenant.mock.calls[0]?.[0]).toBe('c1');
    expect(withTenant.mock.calls[1]?.[0]).toBe('c2');
    expect(withTenant.mock.calls[1]?.[2]).toEqual({ timeoutMs: 1234 });
    expect(IDS.newId).toHaveBeenCalledTimes(2);
  });

  it('lets a refused invalidation abort the transaction, so the step never writes', async () => {
    const refused: Database = {
      withTenant: vi.fn(async (_companyId: string, work: (tx: Tx) => Promise<unknown>) => {
        const tx = {
          execute: vi.fn(async () => {
            throw new Error('COVERAGE_REASON_INVALID');
          }),
        } as unknown as Tx;
        return work(tx);
      }),
    } as unknown as Database;
    const wrapped = invalidateCoverageInTenant(refused, { newId: () => 'id' });
    await expect(wrapped.withTenant('c1', async () => 'never')).rejects.toThrow(
      'COVERAGE_REASON_INVALID',
    );
  });
});
