import { expect, it } from 'vitest';

import { ServiceImportError } from '../errors.ts';
import { requireServiceImportRequestExpiry } from '../service-import.ts';

// المساواة منتهية: الطلب المقبول عند لحظة الانتهاء بالضبط مرفوض (FR-008).
it('accepts a request strictly before the expiry', () => {
  expect(() =>
    requireServiceImportRequestExpiry('2026-11-23T10:00:00Z', new Date('2026-11-22T10:00:00Z')),
  ).not.toThrow();
});

it.each([
  ['at the expiry instant', '2026-11-22T10:00:00Z'],
  ['after the expiry instant', '2026-11-22T09:59:59.999Z'],
  ['a whole day before the expiry', '2026-11-21T10:00:00Z'],
])('refuses %s with the named expiry refusal', (_name, expiresAt) => {
  expect(() => requireServiceImportRequestExpiry(expiresAt, new Date('2026-11-22T10:00:00Z'))).toThrow(
    ServiceImportError,
  );
  try {
    requireServiceImportRequestExpiry(expiresAt, new Date('2026-11-22T10:00:00Z'));
  } catch (error) {
    expect((error as ServiceImportError).code).toBe('IMPORT_PREVIEW_EXPIRED');
  }
});
