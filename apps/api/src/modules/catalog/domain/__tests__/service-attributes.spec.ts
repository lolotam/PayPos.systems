import { expect, it } from 'vitest';

import { ServiceError } from '../errors.ts';
import {
  assertCategoryAssignable,
  categoriesToLock,
  categoryChanged,
  nextCategoryId,
  type ServiceCategoryLock,
} from '../service-category-assignment.ts';
import {
  newService,
  planServiceUpdate,
  serviceResponse,
  serviceTerms,
  serviceUpdateTerms,
  toCommissionRule,
  type ServiceRecord,
  type ServiceTerms,
} from '../service.ts';
import { validateServiceDraft, validateServiceDuration } from '../service-validation.ts';

const terms = (patch: Partial<ServiceTerms> = {}): ServiceTerms => ({
  name_en: 'Synthetic service',
  name_ar: null,
  price: 12_500n,
  commission_rule: { kind: 'FOLLOW_PLAN' },
  counts_toward_threshold: true,
  duration_minutes: null,
  category_id: null,
  ...patch,
});

const record = (patch: Partial<ServiceRecord> = {}): ServiceRecord => ({
  ...newService(terms(), 'svc-1', 'biz-1', new Date('2026-11-01T10:00:00Z')),
  ...patch,
});

const input = (patch: Partial<Parameters<typeof serviceUpdateTerms>[0]> = {}) => ({
  name_en: 'Synthetic service',
  price: '12.500',
  commission_rule: { kind: 'FOLLOW_PLAN' } as const,
  ...patch,
});

it('SV-A1 accepts a duration of 1 and 600 and no duration at all', () => {
  expect(validateServiceDuration(1)).toBeNull();
  expect(validateServiceDuration(600)).toBeNull();
  expect(validateServiceDuration(null)).toBeNull();
});

it.each([0, 601, -5, 7.5, Number.NaN])('SV-A2 refuses the duration %o', (value) => {
  const error = validateServiceDuration(value);
  expect(error).toBeInstanceOf(ServiceError);
  expect(error?.code).toBe('SERVICE_DURATION_INVALID');
});

it('SV-A3 the draft check stops at the first error and reaches the duration', () => {
  expect(() => validateServiceDraft(terms({ name_en: '', duration_minutes: 0 }))).toThrow(
    'SERVICE_NAME_INVALID',
  );
  expect(() => validateServiceDraft(terms({ duration_minutes: 0 }))).toThrow(
    'SERVICE_DURATION_INVALID',
  );
  expect(() => validateServiceDraft(terms({ duration_minutes: 30 }))).not.toThrow();
});

it('SV-A4 an omitted duration or category keeps the stored value', () => {
  const current = record({ duration_minutes: 45, category_id: 'cat-1' });
  expect(serviceUpdateTerms(input(), current)).toMatchObject({
    duration_minutes: 45,
    category_id: 'cat-1',
  });
});

it('SV-A5 a null duration or category clears the stored value', () => {
  const current = record({ duration_minutes: 45, category_id: 'cat-1' });
  expect(
    serviceUpdateTerms(input({ duration_minutes: null, category_id: null }), current),
  ).toMatchObject({ duration_minutes: null, category_id: null });
});

it('SV-A6 a sent duration or category replaces the stored value', () => {
  const current = record({ duration_minutes: 45, category_id: 'cat-1' });
  expect(
    serviceUpdateTerms(input({ duration_minutes: 90, category_id: 'cat-2' }), current),
  ).toMatchObject({ duration_minutes: 90, category_id: 'cat-2' });
});

it('SV-A7 a duration-only or category-only change is a change worth saving', () => {
  const current = record({ duration_minutes: 45, category_id: 'cat-1', revision: 2 });
  const durationOnly = planServiceUpdate(
    current,
    terms({ duration_minutes: 60 }),
    2,
    new Date('2026-11-02T10:00:00Z'),
  );
  expect(durationOnly.changed).toBe(true);
  expect(durationOnly.after.duration_minutes).toBe(60);
  const categoryOnly = planServiceUpdate(
    current,
    terms({ category_id: 'cat-2' }),
    2,
    new Date('2026-11-02T10:00:00Z'),
  );
  expect(categoryOnly.changed).toBe(true);
  expect(categoryOnly.after.category_id).toBe('cat-2');
  const same = planServiceUpdate(
    current,
    terms({ duration_minutes: 45, category_id: 'cat-1' }),
    2,
    new Date('2026-11-02T10:00:00Z'),
  );
  expect(same.changed).toBe(false);
});

it('SV-A8 the next category keeps the stored one on omission and clears on null', () => {
  expect(nextCategoryId(undefined, 'cat-1')).toBe('cat-1');
  expect(nextCategoryId(null, 'cat-1')).toBeNull();
  expect(nextCategoryId('cat-2', 'cat-1')).toBe('cat-2');
  expect(nextCategoryId(undefined, null)).toBeNull();
});

it('SV-A9 the lock order is the distinct ids ascending', () => {
  expect(categoriesToLock(null, null)).toEqual([]);
  expect(categoriesToLock('cat-1', 'cat-1')).toEqual(['cat-1']);
  expect(categoriesToLock('cat-2', 'cat-1')).toEqual(['cat-1', 'cat-2']);
  expect(categoriesToLock('cat-1', null)).toEqual(['cat-1']);
});

it('SV-A10 an unknown or foreign category is refused, a closed one is refused separately', () => {
  expect(() => assertCategoryAssignable(null, 'biz-1')).toThrow('SERVICE_CATEGORY_NOT_FOUND');
  expect(() =>
    assertCategoryAssignable({ business_id: 'biz-2', closed_at: null }, 'biz-1'),
  ).toThrow('SERVICE_CATEGORY_NOT_FOUND');
  expect(() =>
    assertCategoryAssignable(
      { business_id: 'biz-1', closed_at: '2026-11-01T10:00:00.000Z' },
      'biz-1',
    ),
  ).toThrow('SERVICE_CATEGORY_CLOSED');
  expect(() =>
    assertCategoryAssignable({ business_id: 'biz-1', closed_at: null }, 'biz-1'),
  ).not.toThrow();
});

it('SV-A11 the category change is reported only when the id really changed', () => {
  expect(categoryChanged('cat-1', 'cat-1')).toBe(false);
  expect(categoryChanged('cat-1', 'cat-2')).toBe(true);
  expect(categoryChanged(null, 'cat-1')).toBe(true);
  expect(categoryChanged('cat-1', null)).toBe(true);
  expect(categoryChanged(null, null)).toBe(false);
});

it('SV-A12 the exported rule conversion keeps the wire-to-domain behaviour', () => {
  expect(toCommissionRule({ kind: 'PCT', value: 500 })).toEqual({ kind: 'PCT', value: 500n });
  expect(toCommissionRule({ kind: 'FIXED', value: '2.000' })).toEqual({
    kind: 'FIXED',
    value: 2000n,
  });
  expect(toCommissionRule({ kind: 'ZERO' })).toEqual({ kind: 'ZERO' });
  expect(toCommissionRule({ kind: 'FOLLOW_PLAN' })).toEqual({ kind: 'FOLLOW_PLAN' });
  expect(() => toCommissionRule({ kind: 'PCT', value: 1.5 })).toThrow(
    'SERVICE_COMMISSION_RULE_INVALID',
  );
  expect(() => toCommissionRule({ kind: 'ZERO', value: 1 } as never)).toThrow(
    'SERVICE_COMMISSION_RULE_INVALID',
  );
});

it('SV-A13 an upper-case category id comes out lower case, so the lock finds the row', () => {
  const upper = '0192ABCD-0000-7000-8000-0000000005C1';
  const lower = upper.toLowerCase();
  expect(serviceTerms({ ...input(), category_id: upper }).category_id).toBe(lower);
  expect(nextCategoryId(upper, lower)).toBe(lower);
  expect(categoryChanged(lower, nextCategoryId(upper, lower))).toBe(false);
});

it('SV-A14 the response label carries the label fields only, not the locked row', () => {
  const lock: ServiceCategoryLock = {
    id: 'cat-1',
    business_id: 'biz-1',
    name_en: 'Open category',
    name_ar: 'تصنيف مفتوح',
    closed_at: null,
  };
  const response = serviceResponse(record({ category_id: 'cat-1' }), lock);
  expect(response.category).toEqual({
    name_en: 'Open category',
    name_ar: 'تصنيف مفتوح',
    closed_at: null,
  });
});

it('SV-A15 an upper-case business id still matches the locked category', () => {
  expect(() =>
    assertCategoryAssignable({ business_id: 'biz-1', closed_at: null }, 'BIZ-1'),
  ).not.toThrow();
  expect(() =>
    assertCategoryAssignable({ business_id: 'biz-2', closed_at: null }, 'BIZ-1'),
  ).toThrow('SERVICE_CATEGORY_NOT_FOUND');
});
