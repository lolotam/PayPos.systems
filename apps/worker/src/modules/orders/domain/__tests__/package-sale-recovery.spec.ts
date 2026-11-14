import { expect, it } from 'vitest';
import {
  PACKAGE_SALE_STALE_AFTER_MS,
  packageSaleStaleBefore,
} from '../package-sale-recovery.ts';

const NOW = new Date('2026-11-05T12:00:00.000Z');

it('cuts the stale boundary at exactly ten minutes before the worker clock', () => {
  expect(PACKAGE_SALE_STALE_AFTER_MS).toBe(600_000);
  expect(packageSaleStaleBefore(NOW).toISOString()).toBe('2026-11-05T11:50:00.000Z');
});

it('treats a request pending for exactly ten minutes as stale', () => {
  const recordedAt = new Date(NOW.getTime() - PACKAGE_SALE_STALE_AFTER_MS);
  expect(recordedAt.toISOString()).toBe('2026-11-05T11:50:00.000Z');
  // الحد شامل، فالطلب المسجل على الحد بالظبط يقع في ترشيح الاستعادة.
  expect(recordedAt.getTime() <= packageSaleStaleBefore(NOW).getTime()).toBe(true);
});

it('keeps a request younger than ten minutes out of the stale boundary', () => {
  const recordedAt = new Date(NOW.getTime() - PACKAGE_SALE_STALE_AFTER_MS + 1);
  expect(recordedAt.getTime() <= packageSaleStaleBefore(NOW).getTime()).toBe(false);
});
