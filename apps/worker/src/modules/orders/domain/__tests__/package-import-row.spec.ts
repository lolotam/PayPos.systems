import { expect, it } from 'vitest';
import { parsePackageImportRow, indexPackageImportServices } from '../package-import-row.ts';
import { allocatePackagePrice, validatePackageDefinition } from '@pospay/domain';
import { createPackageSlots } from '@pospay/domain';

const services = [
  { id: 'a', name_en: 'Hair', name_ar: 'شعر', price: '99.000' },
  { id: 'b', name_en: 'Nails', name_ar: null, price: '1.000' },
];
const cells = [
  '+99912345678',
  'Legacy',
  null,
  '10.001',
  '2020-01-01',
  'external-1',
  ' hair ',
  1,
  0,
  'Nails',
  2,
  1,
] as const;

it('accepts expired packages and preserves the last-session remainder across components', () => {
  const result = parsePackageImportRow(7, cells, indexPackageImportServices(services));
  expect(result.errors).toEqual([]);
  expect(result.value?.expires_on).toBe('2020-01-01');
  expect(
    result.value?.components.map((component) => [
      component.component_value,
      component.base_unit_value,
      component.last_unit_value,
      component.remaining,
    ]),
  ).toEqual([
    ['3.333', '3.333', '3.333', 0],
    ['6.668', '3.333', '3.335', 1],
  ]);
});
it.each([
  [0, 'invalid', 'IMPORT_PHONE_INVALID'],
  [3, '1.0001', 'INVALID_PRICE'],
  [3, '-1', 'INVALID_PRICE'],
  [4, '2026-02-30', 'IMPORT_DATE_INVALID'],
  [5, '', 'IMPORT_EXTERNAL_REF_INVALID'],
  [1, 'N'.repeat(256), 'IMPORT_NAME_INVALID'],
  [2, 'bad\u0001name', 'IMPORT_NAME_INVALID'],
  [7, 0, 'INVALID_SESSIONS'],
  [8, 2, 'INVALID_REMAINING_SESSIONS'],
  [6, 'unknown', 'IMPORT_SERVICE_NOT_FOUND'],
  [8, null, 'IMPORT_REQUIRED_CELL'],
])('rejects invalid column %s without exposing its value', (column, value, code) => {
  const input = [...cells] as (string | number | null)[];
  input[Number(column)] = value;
  const result = parsePackageImportRow(2, input, indexPackageImportServices(services));
  expect(result.value).toBeNull();
  expect(result.errors).toContainEqual(expect.objectContaining({ row: 2, code }));
  expect(JSON.stringify(result.errors)).not.toContain(cells[0]);
});
it('rejects ambiguous bilingual service names', () => {
  const result = parsePackageImportRow(
    2,
    cells,
    indexPackageImportServices([
      ...services,
      { id: 'c', name_en: 'Other', name_ar: 'HAIR', price: '0.000' },
    ]),
  );
  expect(result.errors).toContainEqual({
    row: 2,
    column: 'service_1',
    code: 'IMPORT_SERVICE_AMBIGUOUS',
  });
});
it('conserves every fils with zero and small amounts and uneven component counts', () => {
  for (const price of [0n, 1n, 2n, 10001n, 99999999999999n]) {
    const components = allocatePackagePrice(
      price,
      [
        { serviceId: 'a', sessions: 3, listPriceSnapshot: 100n },
        { serviceId: 'b', sessions: 7, listPriceSnapshot: 1n },
      ],
      'session-count',
    );
    const slots = components.flatMap((component) =>
      createPackageSlots(component.componentValue, component.sessions, 0, component.sessionValues),
    );
    expect(slots.reduce((sum, slot) => sum + slot.unitValue, 0n)).toBe(price);
    expect(slots.slice(0, -1).every((slot) => slot.unitValue === price / 10n)).toBe(true);
    expect(slots.at(-1)?.unitValue).toBe(price / 10n + (price % 10n));
  }
});

it('reports a negative price once on its source column without a duplicate component error', () => {
  const input = [...cells] as (string | number | null)[];
  input[3] = '-1.000';
  expect(parsePackageImportRow(2, input, indexPackageImportServices(services))).toEqual({
    value: null,
    errors: [{ row: 2, column: 'price_paid', code: 'INVALID_PRICE' }],
  });
});

it('collects every invalid component cell across groups without changing validation rules', () => {
  expect(() =>
    validatePackageDefinition(0n, [
      { serviceId: 'a', sessions: 0, remainingSessions: -1 },
      { serviceId: 'b', sessions: 366, remainingSessions: 367 },
    ]),
  ).toThrow('INVALID_SESSIONS');
  const input = [
    ...cells.slice(0, 6),
    'Hair',
    0,
    -1,
    null,
    null,
    null,
    'Nails',
    366,
    367,
    'Hair',
    1,
    2,
  ];
  expect(parsePackageImportRow(8, input, indexPackageImportServices(services))).toEqual({
    value: null,
    errors: [
      { row: 8, column: 'sessions_1', code: 'INVALID_SESSIONS' },
      { row: 8, column: 'remaining_1', code: 'INVALID_REMAINING_SESSIONS' },
      { row: 8, column: 'sessions_3', code: 'INVALID_SESSIONS' },
      { row: 8, column: 'remaining_3', code: 'INVALID_REMAINING_SESSIONS' },
      { row: 8, column: 'service_4', code: 'DUPLICATE_SERVICE' },
      { row: 8, column: 'remaining_4', code: 'INVALID_REMAINING_SESSIONS' },
    ],
  });
});
