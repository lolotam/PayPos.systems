import { describe, expect, it } from 'vitest';

import { planServiceClose, planServiceReopen } from '../service-closing.ts';
import type { ServiceCategoryLock } from '../service-category-assignment.ts';
import type { ServiceRecord } from '../service.ts';

const at = new Date('2026-11-13T09:00:00.000Z');
const closedIso = '2026-11-12T09:00:00.000Z';
const categoryId = '01920000-0000-7000-8000-000000000012';

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

function category(overrides: Partial<ServiceCategoryLock> = {}): ServiceCategoryLock {
  return {
    id: categoryId,
    business_id: '01920000-0000-7000-8000-000000000011',
    name_en: 'Hair Care',
    name_ar: 'العناية بالشعر',
    closed_at: null,
    ...overrides,
  };
}

describe('closing a single service', () => {
  it('refuses a stale revision before it looks at the closed state', () => {
    const current = service({ revision: 3, closed_at: closedIso });
    expect(() => planServiceClose(current, 2, at)).toThrow('SERVICE_REVISION_CONFLICT');
  });

  it('refuses a service that is already closed', () => {
    const current = service({ revision: 3, closed_at: closedIso });
    expect(() => planServiceClose(current, 3, at)).toThrow('SERVICE_ALREADY_CLOSED');
  });

  it('closes the service at the injected time, clears the category marker and raises the revision', () => {
    const current = service({ revision: 3, closed_by_category_id: categoryId });
    const after = planServiceClose(current, 3, at);
    expect(after).toEqual({
      ...current,
      closed_at: at.toISOString(),
      closed_by_category_id: null,
      revision: 4,
      updated_at: at.toISOString(),
    });
    expect(after.closed_by_category_id).toBeNull();
  });

  it('never mutates the record it was given', () => {
    const current = service({ revision: 3 });
    const snapshot = { ...current };
    planServiceClose(current, 3, at);
    expect(current).toEqual(snapshot);
  });
});

describe('reopening a single service', () => {
  it('refuses a stale revision before it looks at the closed state', () => {
    const current = service({ revision: 3, closed_at: null });
    expect(() => planServiceReopen(current, category(), 2, at)).toThrow(
      'SERVICE_REVISION_CONFLICT',
    );
  });

  it('refuses a service that is not closed', () => {
    const current = service({ revision: 3, closed_at: null });
    expect(() => planServiceReopen(current, category(), 3, at)).toThrow('SERVICE_NOT_CLOSED');
  });

  it('refuses to reopen inside a closed category', () => {
    const current = service({ revision: 3, closed_at: closedIso });
    expect(() => planServiceReopen(current, category({ closed_at: closedIso }), 3, at)).toThrow(
      'SERVICE_CATEGORY_CLOSED',
    );
  });

  it('reopens inside an open category and clears the closed state', () => {
    const current = service({ revision: 3, closed_at: closedIso });
    const after = planServiceReopen(current, category(), 3, at);
    expect(after).toEqual({
      ...current,
      closed_at: null,
      closed_by_category_id: null,
      revision: 4,
      updated_at: at.toISOString(),
    });
  });

  it('reopens a service that has no category at all', () => {
    const current = service({ revision: 3, closed_at: closedIso, category_id: null });
    const after = planServiceReopen(current, null, 3, at);
    expect(after).toEqual({
      ...current,
      closed_at: null,
      closed_by_category_id: null,
      revision: 4,
      updated_at: at.toISOString(),
    });
  });

  it('clears the category marker the category close had set', () => {
    const current = service({
      revision: 3,
      closed_at: closedIso,
      closed_by_category_id: categoryId,
    });
    const after = planServiceReopen(current, category(), 3, at);
    expect(after.closed_by_category_id).toBeNull();
  });

  it('never mutates the record it was given', () => {
    const current = service({
      revision: 3,
      closed_at: closedIso,
      closed_by_category_id: categoryId,
    });
    const snapshot = { ...current };
    planServiceReopen(current, category(), 3, at);
    expect(current).toEqual(snapshot);
  });
});
