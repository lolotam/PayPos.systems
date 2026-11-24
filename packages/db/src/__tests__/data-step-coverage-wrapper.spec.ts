import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../client.ts';
import type { IdGenerator, Tx } from '../with-tenant.ts';
import { buildStepApp, invalidateCoverageInTenant } from '../data-steps/coverage.ts';

// وحدة الإبطال لخطوة معلنة INVALIDATES: كل withTenant يبدأ بجملة invalidate_commission_coverage
// على معاملة الخطوة نفسها ثم شغل الخطوة، وكل معاملة بمعرّف حالة جديد. الاختبار بدون قاعدة بيانات
// وكل اختبار يبني مضهكاته الطازجة بنفسه — لا مضهك على مستوى الوحدة يُشار بين الاختبارات.

/** يبني مضهكاً طازجاً لواجهة تطبيق تسجّل ترتيب الجمل؛ جديد في كل اختبار. */
function fakeApp(recorder: string[]): Database {
  return {
    withTenant: vi.fn(async (_companyId: string, work: (tx: Tx) => Promise<unknown>) => {
      const tx = {
        execute: vi.fn(async () => {
          recorder.push('invalidate');
          return undefined;
        }),
      } as unknown as Tx;
      return work(tx);
    }),
    close: vi.fn(async () => undefined),
  } as unknown as Database;
}

describe('invalidateCoverageInTenant', () => {
  it('invalidates coverage inside the tenant transaction before the step work, once per transaction', async () => {
    const recorder: string[] = [];
    const ids: IdGenerator = { newId: vi.fn(() => 'id-a') };
    const wrapped = invalidateCoverageInTenant(fakeApp(recorder), ids);
    const result = await wrapped.withTenant('c1', async (tx) => {
      recorder.push('work');
      expect(tx.execute).toHaveBeenCalledTimes(1);
      return 'ok';
    });
    expect(result).toBe('ok');
    expect(recorder).toEqual(['invalidate', 'work']);
  });

  it('takes a fresh state id for every transaction and forwards the same tenant and options', async () => {
    const recorder: string[] = [];
    const generated: string[] = [];
    const ids: IdGenerator = {
      newId: vi.fn(() => {
        const id = `id-${generated.length + 1}`;
        generated.push(id);
        return id;
      }),
    };
    const app = fakeApp(recorder);
    const withTenant = vi.mocked(app.withTenant);
    const wrapped = invalidateCoverageInTenant(app, ids);
    await wrapped.withTenant('c1', async () => undefined);
    await wrapped.withTenant('c2', async () => undefined, { timeoutMs: 1234 });
    expect(withTenant).toHaveBeenCalledTimes(2);
    expect(withTenant.mock.calls[0]?.[0]).toBe('c1');
    expect(withTenant.mock.calls[1]?.[0]).toBe('c2');
    expect(withTenant.mock.calls[1]?.[2]).toEqual({ timeoutMs: 1234 });
    expect(generated).toEqual(['id-1', 'id-2']);
    expect(new Set(generated).size).toBe(generated.length);
    expect(recorder).toEqual(['invalidate', 'invalidate']);
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

describe('buildStepApp (the one wiring point the registry calls with the declared coverage)', () => {
  it('hands a fresh narrow object in both cases: exactly withTenant and close, nothing else', () => {
    const app = fakeApp([]);
    for (const coverage of ['INVALIDATES', 'NONE'] as const) {
      const handed = buildStepApp(app, { newId: () => 'id' }, coverage);
      expect(Object.keys(handed).sort()).toEqual(['close', 'withTenant']);
      expect(handed).not.toBe(app);
    }
  });

  it('delegates withTenant for NONE and wraps it for INVALIDATES', async () => {
    const plainRecorder: string[] = [];
    const plainApp = fakeApp(plainRecorder);
    const plain = buildStepApp(plainApp, { newId: () => 'id' }, 'NONE');
    await plain.withTenant('c1', async () => 'done');
    expect(plainRecorder).toEqual([]);
    expect(vi.mocked(plainApp.withTenant)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(plainApp.withTenant).mock.calls[0]?.[0]).toBe('c1');

    const wrappedRecorder: string[] = [];
    const wrappedApp = fakeApp(wrappedRecorder);
    const wrapped = buildStepApp(wrappedApp, { newId: () => 'id' }, 'INVALIDATES');
    await wrapped.withTenant('c2', async () => 'done');
    expect(wrappedRecorder).toEqual(['invalidate']);
  });

  it('closes the handed object idempotently: two closes cut the pool once', async () => {
    const app = fakeApp([]);
    const handed = buildStepApp(app, { newId: () => 'id' }, 'INVALIDATES');
    await handed.close();
    await handed.close();
    expect(app.close).toHaveBeenCalledTimes(1);
  });
});
