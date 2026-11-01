import { expect, it } from 'vitest';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { ServiceCategoryLock } from '../../domain/service-category-assignment.ts';
import type { ServiceRecord } from '../../domain/service.ts';
import type {
  ServiceActor,
  ServiceScope,
  ServiceTransactions,
} from '../../ports/service-transactions.port.ts';
import { UpdateServiceUseCase } from '../update-service/update-service.usecase.ts';

const RECORD: ServiceRecord = {
  id: 'svc-1',
  business_id: 'biz-1',
  name_en: 'Synthetic service',
  name_ar: null,
  price: 12_500n,
  commission_rule: { kind: 'FOLLOW_PLAN' },
  counts_toward_threshold: true,
  duration_minutes: null,
  category_id: 'cat-load',
  revision: 1,
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
};

const clock: Clock = { now: () => new Date('2026-11-02T10:00:00.000Z') };

/** بورت في الذاكرة: القراءة الأولى والصف المقفول بيرجّعوا اللي الاختبار حدّده، والكتابات بتتسجّل. */
function fakeTransactions(options: {
  readonly peekCategoryId: string | null;
  readonly record: ServiceRecord | null;
}): { readonly transactions: ServiceTransactions; readonly writes: string[] } {
  const writes: string[] = [];
  const scope: ServiceScope = {
    insert: async () => undefined,
    load: async () => options.record,
    peekCategoryId: async () =>
      options.peekCategoryId === null ? null : { category_id: options.peekCategoryId },
    lockCategories: async () => new Map<string, ServiceCategoryLock>(),
    save: async () => {
      writes.push('save');
    },
    audit: async () => {
      writes.push('audit');
    },
  };
  const transactions: ServiceTransactions = {
    run: async <T>(_actor: ServiceActor, work: (scope: ServiceScope) => Promise<T>): Promise<T> =>
      work(scope),
  };
  return { transactions, writes };
}

it('the update refuses a row that changed between the peek and the lock, and writes nothing', async () => {
  const { transactions, writes } = fakeTransactions({
    peekCategoryId: 'cat-peek',
    record: RECORD,
  });
  const useCase = new UpdateServiceUseCase(transactions, clock);
  await expect(
    useCase.execute({
      companyId: 'company-1',
      userId: 'user-1',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      input: {
        expected_revision: 1,
        name_en: 'Synthetic service',
        name_ar: null,
        price: '12.500',
        commission_rule: { kind: 'FOLLOW_PLAN' },
        counts_toward_threshold: true,
      },
    }),
  ).rejects.toThrow('SERVICE_REVISION_CONFLICT');
  expect(writes).toEqual([]);
});
