import { expect, it } from 'vitest';
import { parsePackageImportSheet, resolvePackageImportRows } from '../package-import-validation.ts';
import { parsePackageImportRow, indexPackageImportServices } from '../package-import-row.ts';
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
  const result = parsePackageImportRow(2, cells, indexPackageImportServices(services));
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

it('preserves normalized bilingual matching, duplicate identity precedence, ambiguity and missing names', () => {
  const services = [
    { id: 'a', name_en: ' Hair ', name_ar: 'HAIR', price: '99.000' },
    { id: 'a', name_en: 'hair', name_ar: 'شعر', price: '3.000' },
    { id: 'b', name_en: 'Nails', name_ar: null, price: '1.000' },
    { id: 'c', name_en: 'Shared', name_ar: null, price: '1.000' },
    { id: 'd', name_en: 'Other', name_ar: ' SHARED ', price: '1.000' },
  ];
  const labels = [' hAiR ', 'شعر', 'NAILS', 'shared', 'missing'];
  const parsed = parsePackageImportSheet(
    labels.map((label, index) => ({
      row: index + 2,
      cells: [...row.slice(0, 5), `matching-${index}`, label, 1, 0],
    })),
    services,
  );
  expect(
    parsed.rows.map((source) => [
      source.row,
      source.components[0]?.service_id,
      source.components[0]?.list_price_snapshot,
    ]),
  ).toEqual([
    [2, 'a', '3.000'],
    [3, 'a', '3.000'],
    [4, 'b', '1.000'],
  ]);
  expect(parsed.errors.filter((error) => error.column === 'service_1')).toEqual([
    { row: 5, column: 'service_1', code: 'IMPORT_SERVICE_AMBIGUOUS' },
    { row: 6, column: 'service_1', code: 'IMPORT_SERVICE_NOT_FOUND' },
  ]);
});
