import { describe, expect, it } from 'vitest';

import {
  assertServiceCategoryCloseable,
  assertServiceCategoryReopenable,
  planServiceCategoryClose,
  planServiceCategoryReopen,
  type ServiceCategoryClosingRequest,
} from '../service-category-closing.ts';
import type { ServiceCategoryRecord } from '../service-category.ts';
import type { ServiceRecord } from '../service.ts';

const at = new Date('2026-11-13T09:00:00.000Z');
const closedIso = '2026-11-12T09:00:00.000Z';
const categoryId = '01920000-0000-7000-8000-000000000012';
const otherCategoryId = '01920000-0000-7000-8000-000000000013';

function category(overrides: Partial<ServiceCategoryRecord> = {}): ServiceCategoryRecord {
  return {
    id: categoryId,
    business_id: '01920000-0000-7000-8000-000000000011',
    name_en: 'Hair Care',
    name_ar: 'العناية بالشعر',
    owner_branch_id: null,
    visibility: 'BUSINESS',
    closed_at: null,
    revision: 4,
    created_at: '2026-11-01T09:00:00.000Z',
    updated_at: '2026-11-01T09:00:00.000Z',
    ...overrides,
  };
}

function service(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: '01920000-0000-7000-8000-000000000010',
    business_id: '01920000-0000-7000-8000-000000000011',
    name_en: 'Hair Cut',
    name_ar: 'قص شعر',
    price: 12_500n,
    commission_rule: { kind: 'FOLLOW_PLAN' },
    counts_toward_threshold: true,
    duration_minutes: 45,
    category_id: categoryId,
    closed_at: null,
    closed_by_category_id: null,
    revision: 3,
    created_at: '2026-11-01T09:00:00.000Z',
    updated_at: '2026-11-01T09:00:00.000Z',
    ...overrides,
  };
}

function request(
  expected_revision: number,
  expected_service_count: number,
): ServiceCategoryClosingRequest {
  return { expected_revision, expected_service_count };
}

describe('closing a category: what it refuses', () => {
  it('refuses a stale revision before it looks at the closed state', () => {
    const current = category({ revision: 4, closed_at: closedIso });
    expect(() => planServiceCategoryClose(current, request(3, 0), [], at)).toThrow(
      'SERVICE_CATEGORY_REVISION_CONFLICT',
    );
  });

  it('refuses a category that is already closed', () => {
    const current = category({ revision: 4, closed_at: closedIso });
    expect(() => planServiceCategoryClose(current, request(4, 0), [], at)).toThrow(
      'SERVICE_CATEGORY_ALREADY_CLOSED',
    );
  });

  it.each([
    { relation: 'above', count: 3 },
    { relation: 'below', count: 1 },
  ])('refuses a service count $relation the number of open services', ({ count }) => {
    const current = category();
    const services = [service({ id: 'svc-1' }), service({ id: 'svc-2' })];
    expect(() => planServiceCategoryClose(current, request(4, count), services, at)).toThrow(
      'SERVICE_CATEGORY_COUNT_CHANGED',
    );
  });
});

describe('closing a category: the plan it returns', () => {
  it('closes the category and every open service at the injected time', () => {
    const current = category();
    const open = service({ id: 'svc-1' });
    const plan = planServiceCategoryClose(current, request(4, 1), [open], at);
    expect(plan.category.after).toEqual({
      ...current,
      closed_at: at.toISOString(),
      revision: 5,
      updated_at: at.toISOString(),
    });
    expect(plan.services).toHaveLength(1);
    expect(plan.services[0]?.after).toEqual({
      ...open,
      closed_at: at.toISOString(),
      closed_by_category_id: categoryId,
      revision: 4,
      updated_at: at.toISOString(),
    });
  });

  it('leaves an already-closed service out of the plan and counts only the open ones', () => {
    const current = category();
    const open = service({ id: 'svc-1' });
    const alreadyClosed = service({ id: 'svc-2', closed_at: closedIso, revision: 5 });
    const plan = planServiceCategoryClose(current, request(4, 1), [open, alreadyClosed], at);
    expect(plan.services).toHaveLength(1);
    expect(plan.services[0]?.before).toBe(open);
    expect(alreadyClosed.closed_at).toBe(closedIso);
    expect(alreadyClosed.closed_by_category_id).toBeNull();
    expect(() =>
      planServiceCategoryClose(current, request(4, 2), [open, alreadyClosed], at),
    ).toThrow('SERVICE_CATEGORY_COUNT_CHANGED');
  });

  it('closes a category that has no open service at all', () => {
    const current = category();
    const alreadyClosed = service({ id: 'svc-1', closed_at: closedIso });
    const plan = planServiceCategoryClose(current, request(4, 0), [alreadyClosed], at);
    expect(plan.services).toEqual([]);
    expect(plan.category.after.closed_at).toBe(at.toISOString());
  });
});

describe('closing a category: the records it keeps', () => {
  it('keeps the original records as the before state', () => {
    const current = category();
    const open = service({ id: 'svc-1' });
    const plan = planServiceCategoryClose(current, request(4, 1), [open], at);
    expect(plan.category.before).toBe(current);
    expect(plan.services[0]?.before).toBe(open);
  });

  it('never mutates the records it was given', () => {
    const current = category();
    const open = service({ id: 'svc-1' });
    const categorySnapshot = { ...current };
    const serviceSnapshot = { ...open };
    planServiceCategoryClose(current, request(4, 1), [open], at);
    expect(current).toEqual(categorySnapshot);
    expect(open).toEqual(serviceSnapshot);
  });
});

describe('reopening a category: what it refuses', () => {
  it('refuses a stale revision before it looks at the closed state', () => {
    const current = category({ revision: 4, closed_at: null });
    expect(() => planServiceCategoryReopen(current, request(3, 0), [], at)).toThrow(
      'SERVICE_CATEGORY_REVISION_CONFLICT',
    );
  });

  it('refuses a category that is not closed', () => {
    const current = category({ revision: 4, closed_at: null });
    expect(() => planServiceCategoryReopen(current, request(4, 0), [], at)).toThrow(
      'SERVICE_CATEGORY_NOT_CLOSED',
    );
  });

  it.each([
    { relation: 'above', count: 2 },
    { relation: 'below', count: 0 },
  ])(
    'refuses a service count $relation the number of services this category closed',
    ({ count }) => {
      const current = category({ revision: 4, closed_at: closedIso });
      const marked = service({
        id: 'svc-1',
        closed_at: closedIso,
        closed_by_category_id: categoryId,
      });
      expect(() => planServiceCategoryReopen(current, request(4, count), [marked], at)).toThrow(
        'SERVICE_CATEGORY_COUNT_CHANGED',
      );
    },
  );
});

describe('reopening a category: the plan it returns', () => {
  it('reopens the category and the services it closed', () => {
    const current = category({ revision: 4, closed_at: closedIso });
    const marked = service({
      id: 'svc-1',
      revision: 6,
      closed_at: closedIso,
      closed_by_category_id: categoryId,
    });
    const plan = planServiceCategoryReopen(current, request(4, 1), [marked], at);
    expect(plan.category.after).toEqual({
      ...current,
      closed_at: null,
      revision: 5,
      updated_at: at.toISOString(),
    });
    expect(plan.services).toHaveLength(1);
    expect(plan.services[0]?.after).toEqual({
      ...marked,
      closed_at: null,
      closed_by_category_id: null,
      revision: 7,
      updated_at: at.toISOString(),
    });
  });

  it('reopens only the services this category closed and counts only those', () => {
    const current = category({ revision: 4, closed_at: closedIso });
    const marked = service({
      id: 'svc-1',
      closed_at: closedIso,
      closed_by_category_id: categoryId,
    });
    const individuallyClosed = service({
      id: 'svc-2',
      closed_at: closedIso,
      closed_by_category_id: null,
    });
    const markedByAnother = service({
      id: 'svc-3',
      closed_at: closedIso,
      closed_by_category_id: otherCategoryId,
    });
    const all = [marked, individuallyClosed, markedByAnother];
    const plan = planServiceCategoryReopen(current, request(4, 1), all, at);
    expect(plan.services).toHaveLength(1);
    expect(plan.services[0]?.before).toBe(marked);
    expect(individuallyClosed.closed_at).toBe(closedIso);
    expect(markedByAnother.closed_at).toBe(closedIso);
    expect(markedByAnother.closed_by_category_id).toBe(otherCategoryId);
    expect(() => planServiceCategoryReopen(current, request(4, 3), all, at)).toThrow(
      'SERVICE_CATEGORY_COUNT_CHANGED',
    );
  });
});

describe('reopening a category: the order of the services', () => {
  it('keeps the order of the services as it was given', () => {
    const current = category({ revision: 4, closed_at: closedIso });
    const services = [
      service({ id: 'svc-3', closed_at: closedIso, closed_by_category_id: categoryId }),
      service({ id: 'svc-1', closed_at: closedIso, closed_by_category_id: categoryId }),
      service({ id: 'svc-2', closed_at: closedIso, closed_by_category_id: categoryId }),
    ];
    const plan = planServiceCategoryReopen(current, request(4, 3), services, at);
    expect(plan.services.map((change) => change.before.id)).toEqual(['svc-3', 'svc-1', 'svc-2']);
  });
});

describe('reopening a category: the records it keeps', () => {
  it('keeps the original records as the before state', () => {
    const current = category({ revision: 4, closed_at: closedIso });
    const marked = service({
      id: 'svc-1',
      closed_at: closedIso,
      closed_by_category_id: categoryId,
    });
    const plan = planServiceCategoryReopen(current, request(4, 1), [marked], at);
    expect(plan.category.before).toBe(current);
    expect(plan.services[0]?.before).toBe(marked);
  });

  it('never mutates the records it was given', () => {
    const current = category({ revision: 4, closed_at: closedIso });
    const marked = service({
      id: 'svc-1',
      closed_at: closedIso,
      closed_by_category_id: categoryId,
    });
    const categorySnapshot = { ...current };
    const serviceSnapshot = { ...marked };
    planServiceCategoryReopen(current, request(4, 1), [marked], at);
    expect(current).toEqual(categorySnapshot);
    expect(marked).toEqual(serviceSnapshot);
  });
});

describe('assertServiceCategoryCloseable', () => {
  it.each([
    {
      scenario: 'refuses a stale revision',
      closedAt: null,
      revision: 3,
      error: 'SERVICE_CATEGORY_REVISION_CONFLICT',
    },
    {
      scenario: 'gives revision conflict precedence over an already-closed state',
      closedAt: closedIso,
      revision: 3,
      error: 'SERVICE_CATEGORY_REVISION_CONFLICT',
    },
    {
      scenario: 'refuses an already-closed category with the current revision',
      closedAt: closedIso,
      revision: 4,
      error: 'SERVICE_CATEGORY_ALREADY_CLOSED',
    },
    {
      scenario: 'accepts an open category with the current revision',
      closedAt: null,
      revision: 4,
      error: null,
    },
  ])('$scenario', ({ closedAt, revision, error }) => {
    const check = () =>
      assertServiceCategoryCloseable(category({ closed_at: closedAt }), request(revision, 0));
    if (error === null) expect(check).not.toThrow();
    else expect(check).toThrow(error);
  });
});

describe('assertServiceCategoryReopenable', () => {
  it.each([
    {
      scenario: 'refuses a stale revision',
      closedAt: closedIso,
      revision: 3,
      error: 'SERVICE_CATEGORY_REVISION_CONFLICT',
    },
    {
      scenario: 'gives revision conflict precedence over a not-closed state',
      closedAt: null,
      revision: 3,
      error: 'SERVICE_CATEGORY_REVISION_CONFLICT',
    },
    {
      scenario: 'refuses a not-closed category with the current revision',
      closedAt: null,
      revision: 4,
      error: 'SERVICE_CATEGORY_NOT_CLOSED',
    },
    {
      scenario: 'accepts a closed category with the current revision',
      closedAt: closedIso,
      revision: 4,
      error: null,
    },
  ])('$scenario', ({ closedAt, revision, error }) => {
    const check = () =>
      assertServiceCategoryReopenable(category({ closed_at: closedAt }), request(revision, 0));
    if (error === null) expect(check).not.toThrow();
    else expect(check).toThrow(error);
  });
});
