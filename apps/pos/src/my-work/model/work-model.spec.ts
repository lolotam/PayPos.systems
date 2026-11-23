import { expect, it } from 'vitest';
import type { OwnServiceLine } from '@pospay/contracts';
import {
  WorkHttpError,
  monthOutOfRange,
  sessionEnded,
  windowExpired,
  workForbidden,
} from './work-error';
import {
  branchName,
  formatCancelledOn,
  formatLineTime,
  formatShare,
  hasService,
  serviceName,
} from './work-format';
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

it('AC-57-4-9 shows a line time and a cancellation date in the business zone, never the process zone', () => {
  const instant = '2026-11-14T21:30:00Z';
  const previous = process.env.TZ;
  try {
    for (const processZone of ['America/Los_Angeles', 'Pacific/Auckland', 'UTC']) {
      process.env.TZ = processZone;
      expect(formatLineTime(instant, 'en', 'Asia/Kuwait')).toBe('00:30');
      expect(formatCancelledOn(instant, 'en', 'Asia/Kuwait')).toBe('November 15, 2026');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

it('AC-57-4-9 follows the zone it is given, so a business west of UTC keeps the earlier day', () => {
  const instant = '2026-11-14T21:30:00Z';
  expect(formatLineTime(instant, 'en', 'America/New_York')).toBe('16:30');
  expect(formatCancelledOn(instant, 'en', 'America/New_York')).toBe('November 14, 2026');
});

it('AC-57-4-9 labels UTC instead of throwing or using the device zone for a zone this runtime does not know', () => {
  const instant = '2026-11-14T21:30:00Z';
  const previous = process.env.TZ;
  try {
    for (const processZone of ['America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = processZone;
      expect(formatLineTime(instant, 'en', 'Not/A_Zone')).toBe('21:30 UTC');
      expect(formatCancelledOn(instant, 'en', 'Not/A_Zone')).toBe('November 14, 2026 at 21:30 UTC');
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
