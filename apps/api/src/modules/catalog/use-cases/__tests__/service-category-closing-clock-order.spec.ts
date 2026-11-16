import { describe, expect, it } from 'vitest';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import type {
  ServiceCategoryClosingAudit,
  ServiceCategoryActor,
  ServiceCategoryScope,
  ServiceCategoryTransactions,
} from '../../ports/service-category-transactions.port.ts';
import type { ServiceRecordChange } from '../../domain/service-category-closing.ts';
import type { ServiceCategoryRecord } from '../../domain/service-category.ts';
import type { ServiceRecord } from '../../domain/service.ts';
import { CloseServiceCategoryUseCase } from '../close-service-category/close-service-category.usecase.ts';
import { ReopenServiceCategoryUseCase } from '../reopen-service-category/reopen-service-category.usecase.ts';

const ids: IdGenerator = { newId: () => 'closing-1' };

function category(closedAt: string | null): ServiceCategoryRecord {
  return {
    id: 'category-1',
    business_id: 'business-1',
    name_en: 'Synthetic category',
    name_ar: 'تصنيف تجريبي',
    owner_branch_id: null,
    visibility: 'BUSINESS',
    closed_at: closedAt,
    revision: 1,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
  };
}

function service(closedAt: string | null, closedByCategoryId: string | null): ServiceRecord {
  return {
    id: 'service-1',
    business_id: 'business-1',
    name_en: 'Synthetic service',
    name_ar: null,
    price: 12_500n,
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: null,
    category_id: 'category-1',
    closed_at: closedAt,
    closed_by_category_id: closedByCategoryId,
    revision: 1,
    created_at: '2026-11-01T10:00:00.000Z',
    updated_at: '2026-11-01T10:00:00.000Z',
  };
}

function advancingClock(events: string[]): { readonly clock: Clock; readonly readings: Date[] } {
  const readings: Date[] = [];
  return {
    readings,
    clock: {
      now: () => {
        const at = new Date(Date.UTC(2026, 10, 14, 12, 0, readings.length));
        events.push('now');
        readings.push(at);
        return at;
      },
    },
  };
}

function firstClockAfterLoad(
  events: readonly string[],
  readings: readonly Date[],
): Date | undefined {
  const loadIndex = events.indexOf('load');
  const eventIndex = events.findIndex((event, index) => index > loadIndex && event === 'now');
  if (loadIndex < 0 || eventIndex < 0) return undefined;
  const readingIndex =
    events.slice(0, eventIndex + 1).filter((event) => event === 'now').length - 1;
  return readings[readingIndex];
}

function fakeTransactions(options: {
  readonly current: ServiceCategoryRecord;
  readonly services: ServiceRecord[];
  readonly events: string[];
}): {
  readonly transactions: ServiceCategoryTransactions;
  readonly saved: {
    category?: ServiceRecordChange<ServiceCategoryRecord>;
    services?: readonly ServiceRecordChange<ServiceRecord>[];
    audit?: ServiceCategoryClosingAudit;
  };
} {
  const saved: {
    category?: ServiceRecordChange<ServiceCategoryRecord>;
    services?: readonly ServiceRecordChange<ServiceRecord>[];
    audit?: ServiceCategoryClosingAudit;
  } = {};
  const scope = {
    load: async () => {
      options.events.push('load');
      return options.current;
    },
    findPendingClosing: async () => null,
    countAffectedServices: async () => options.services.length,
    lockOpenServices: async () => options.services,
    lockMarkedServices: async () => options.services,
    saveClosing: async (
      change: ServiceRecordChange<ServiceCategoryRecord>,
      services: readonly ServiceRecordChange<ServiceRecord>[],
    ) => {
      saved.category = change;
      saved.services = services;
    },
    auditClosing: async (entries: ServiceCategoryClosingAudit) => {
      saved.audit = entries;
    },
  } as unknown as ServiceCategoryScope;
  const transactions: ServiceCategoryTransactions = {
    run: async <T>(
      _actor: ServiceCategoryActor,
      work: (scope: ServiceCategoryScope) => Promise<T>,
    ) => work(scope),
  };
  return { transactions, saved };
}

describe('service category mutation clock order', () => {
  it('stamps a synchronous close with the first clock reading after the category lock', async () => {
    const events: string[] = [];
    const { clock, readings } = advancingClock(events);
    const { transactions, saved } = fakeTransactions({
      current: category(null),
      services: [service(null, null)],
      events,
    });
    const useCase = new CloseServiceCategoryUseCase(transactions, clock, ids);

    await useCase.execute({
      companyId: 'company-1',
      userId: 'user-1',
      businessId: 'business-1',
      categoryId: 'category-1',
      input: { expected_revision: 1, expected_service_count: 1 },
    });

    const postLockTime = firstClockAfterLoad(events, readings);
    expect(saved.category?.after.updated_at).toBe(postLockTime?.toISOString());
    expect(saved.category?.after.updated_at).not.toBe(readings[0]?.toISOString());
    expect(events.indexOf('load')).toBeLessThan(events.lastIndexOf('now'));
  });

  it('stamps a synchronous reopen with the first clock reading after the category lock', async () => {
    const events: string[] = [];
    const { clock, readings } = advancingClock(events);
    const closedAt = '2026-11-13T10:00:00.000Z';
    const { transactions, saved } = fakeTransactions({
      current: category(closedAt),
      services: [service(closedAt, 'category-1')],
      events,
    });
    const useCase = new ReopenServiceCategoryUseCase(transactions, clock, ids);

    await useCase.execute({
      companyId: 'company-1',
      userId: 'user-1',
      businessId: 'business-1',
      categoryId: 'category-1',
      input: { expected_revision: 1, expected_service_count: 1 },
    });

    const postLockTime = firstClockAfterLoad(events, readings);
    expect(saved.category?.after.updated_at).toBe(postLockTime?.toISOString());
    expect(saved.category?.after.updated_at).not.toBe(readings[0]?.toISOString());
    expect(events.indexOf('load')).toBeLessThan(events.lastIndexOf('now'));
  });
});
