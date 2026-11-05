import { expect, it } from 'vitest';
import { parsePackageImportSheet, resolvePackageImportRows } from '../package-import-validation.ts';
import { parsePackageImportRow } from '../package-import-row.ts';
import { packageImportStorageKey, packagePreviewExpiresAt } from '../package-import.ts';

const row = [
  '+99912345678',
  'Legacy',
  null,
  '10.001',
  '2020-01-01',
  'old-ref',
  'Old name',
  3,
  1,
] as const;

it('skips an existing reference before validating renamed services, missing customers or obsolete content', () => {
  const parsed = parsePackageImportSheet(
    [{ row: 2, cells: ['bad phone', ...row.slice(1)] }],
    [],
    ['old-ref'],
  );
  expect(resolvePackageImportRows(parsed, [])).toEqual({
    rows: [],
    errors: [],
    skipped: [{ row: 2, external_ref: 'old-ref' }],
  });
});

it('still rejects duplicate existing references inside one file', () => {
  const parsed = parsePackageImportSheet(
    [
      { row: 2, cells: row },
      { row: 5, cells: row },
    ],
    [],
    ['old-ref'],
  );
  expect(parsed.rows).toEqual([]);
  expect(parsed.skipped).toEqual([]);
  expect(parsed.errors).toEqual(
    [2, 5].map((row) => ({ row, column: 'external_ref', code: 'IMPORT_EXTERNAL_REF_DUPLICATE' })),
  );
});

it('stores compact allocation for the maximum component and session counts', () => {
  const services = Array.from({ length: 20 }, (_, index) => ({
    id: `service-${index}`,
    name_en: `Service ${index}`,
    name_ar: null,
    price: '1.000',
  }));
  const cells = [...row.slice(0, 6), ...services.flatMap((service) => [service.name_en, 365, 365])];
  const result = parsePackageImportRow(2, cells, services);
  expect(result.errors).toEqual([]);
  expect(result.value?.components).toHaveLength(20);
  expect(JSON.stringify(result.value).length).toBeLessThan(6000);
  expect(JSON.stringify(result.value)).not.toContain('"slots"');
});

it('validates file ownership, purge state, readiness, type and size before storage', () => {
  const valid = {
    business_id: 'b',
    created_by: 'u',
    content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size_bytes: 1,
    status: 'READY',
    storage_key: 'key',
    purged: false,
    purge_started: false,
  };
  expect(packageImportStorageKey(valid, { businessId: 'b', userId: 'u' })).toBe('key');
  expect(() =>
    packageImportStorageKey({ ...valid, purged: true }, { businessId: 'b', userId: 'u' }),
  ).toThrow('IMPORT_FILE_NOT_FOUND');
  expect(packagePreviewExpiresAt(new Date('2026-11-05T10:00:00Z'))).toBe(
    '2026-11-06T10:00:00.000Z',
  );
});
