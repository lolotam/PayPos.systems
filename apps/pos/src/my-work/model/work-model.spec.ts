import { expect, it } from 'vitest';
import type { OwnServiceLine } from '@pospay/contracts';
import {
  WorkHttpError,
  monthOutOfRange,
  sessionEnded,
  windowExpired,
  workForbidden,
} from './work-error';
import { branchName, formatShare, hasService, serviceName } from './work-format';
import { monthLabel, nextMonth, previousMonth } from './work-month';

const line = (extra: Partial<OwnServiceLine>): OwnServiceLine => ({
  line_id: '00000000-0000-4000-8000-000000000001',
  branch_name_ar: null,
  branch_name_en: 'Main',
  cancelled: false,
  ...extra,
});

it('steps months across a year boundary in both directions', () => {
  expect(previousMonth('2026-01')).toBe('2025-12');
  expect(previousMonth('2026-11')).toBe('2026-10');
  expect(nextMonth('2025-12')).toBe('2026-01');
  expect(nextMonth('2026-09')).toBe('2026-10');
});

it('names a month in both languages with Latin digits', () => {
  expect(monthLabel('2026-11', 'en')).toBe('November 2026');
  expect(monthLabel('2026-11', 'ar')).toContain('2026');
  expect(monthLabel('2026-11', 'ar')).toMatch(/[\u0600-\u06ff]/);
});

it('formats the share from basis points without floats', () => {
  expect(formatShare(5000)).toBe('50%');
  expect(formatShare(3333)).toBe('33.33%');
  expect(formatShare(250)).toBe('2.5%');
  expect(formatShare(0)).toBe('0%');
  expect(formatShare(10000)).toBe('100%');
});

it('picks the service name by language and falls back to English when the Arabic is null', () => {
  const both = line({ service_name_ar: 'قص شعر', service_name_en: 'Haircut' });
  expect(serviceName(both, 'ar')).toBe('قص شعر');
  expect(serviceName(both, 'en')).toBe('Haircut');
  const noArabic = line({ service_name_ar: null, service_name_en: 'Haircut' });
  expect(serviceName(noArabic, 'ar')).toBe('Haircut');
  expect(hasService(noArabic)).toBe(true);
  expect(hasService(line({}))).toBe(false);
});

it('always names the branch, in Arabic when there is one', () => {
  expect(branchName(line({ branch_name_ar: 'الفرع' }), 'ar')).toBe('الفرع');
  expect(branchName(line({ branch_name_ar: null }), 'ar')).toBe('Main');
  expect(branchName(line({ branch_name_ar: 'الفرع' }), 'en')).toBe('Main');
});

it('tells an expired window, a dead session, a forbidden page and an out-of-range month apart by code', () => {
  const expired = new WorkHttpError('PRIVATE_VIEW_EXPIRED', 403);
  const forbidden = new WorkHttpError('FORBIDDEN', 403);
  const dead = new WorkHttpError('UNAUTHENTICATED', 401);
  const wrongPin = new WorkHttpError('PIN_INVALID', 401);
  const range = new WorkHttpError('MY_PERIOD_OUT_OF_RANGE', 422);
  expect([windowExpired(expired), windowExpired(forbidden)]).toEqual([true, false]);
  expect([sessionEnded(dead), sessionEnded(wrongPin), sessionEnded(expired)]).toEqual([
    true,
    false,
    false,
  ]);
  expect([workForbidden(forbidden), workForbidden(expired)]).toEqual([true, false]);
  expect([monthOutOfRange(range), monthOutOfRange(dead)]).toEqual([true, false]);
  expect(windowExpired(new Error('network'))).toBe(false);
});
