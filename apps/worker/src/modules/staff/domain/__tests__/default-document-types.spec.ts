import { expect, it } from 'vitest';
import { defaultDocumentTypes } from '../default-document-types.ts';

it('seeds five types with a 30-day alert; only the work contract has an optional expiry', () => {
  const types = defaultDocumentTypes();
  expect(types.map((t) => t.code)).toEqual([
    'civil_id',
    'passport',
    'residency',
    'health_certificate',
    'work_contract',
  ]);
  expect(types.every((t) => t.alert_days === 30)).toBe(true);
  expect(new Set(types.map((t) => t.name_key)).size).toBe(5);
  expect(types.filter((t) => !t.requires_expiry).map((t) => t.code)).toEqual(['work_contract']);
});
