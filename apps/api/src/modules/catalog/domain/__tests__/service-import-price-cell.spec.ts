import { expect, it } from 'vitest';

import {
  parseServiceImportPriceCell,
  type ServiceImportPriceResult,
  type ServiceImportTaggedCell,
} from '../service-import-price-cell.ts';

const text = (value: string): ServiceImportTaggedCell => ({ kind: 'text', text: value });

const numeric = (value: string, percentFormat = false): ServiceImportTaggedCell => ({
  kind: 'numeric',
  text: value,
  percentFormat,
});

const refused = (result: ServiceImportPriceResult): string | undefined =>
  result.ok ? undefined : result.code;

it('SI-FR005-1 turns a text cell into the canonical three-decimal price', () => {
  expect(parseServiceImportPriceCell(text('12.5'))).toEqual({
    ok: true,
    price: '12.500',
    mills: 12_500n,
  });
  expect(parseServiceImportPriceCell(text('7.500'))).toEqual({
    ok: true,
    price: '7.500',
    mills: 7_500n,
  });
  expect(parseServiceImportPriceCell(text('12'))).toEqual({
    ok: true,
    price: '12.000',
    mills: 12_000n,
  });
});

it('SI-FR005-2 turns a zero into the zero price and pads a fraction', () => {
  expect(parseServiceImportPriceCell(text('0'))).toEqual({ ok: true, price: '0.000', mills: 0n });
  expect(parseServiceImportPriceCell(text('0.000'))).toEqual({
    ok: true,
    price: '0.000',
    mills: 0n,
  });
  expect(parseServiceImportPriceCell(text('0.5'))).toEqual({
    ok: true,
    price: '0.500',
    mills: 500n,
  });
  expect(parseServiceImportPriceCell(text('0.57'))).toEqual({
    ok: true,
    price: '0.570',
    mills: 570n,
  });
});

it('SI-FR005-3 reads a numeric cell through the same rule as a text cell', () => {
  expect(parseServiceImportPriceCell(numeric('12.5'))).toEqual({
    ok: true,
    price: '12.500',
    mills: 12_500n,
  });
  expect(parseServiceImportPriceCell(numeric('0'))).toEqual({
    ok: true,
    price: '0.000',
    mills: 0n,
  });
  expect(parseServiceImportPriceCell(numeric('0.57'))).toEqual({
    ok: true,
    price: '0.570',
    mills: 570n,
  });
});

it('SI-FR005-4 accepts the exact maximum price and refuses ten to the eleventh', () => {
  expect(parseServiceImportPriceCell(text('99999999999.999'))).toEqual({
    ok: true,
    price: '99999999999.999',
    mills: 99_999_999_999_999n,
  });
  expect(refused(parseServiceImportPriceCell(text('100000000000')))).toBe('IMPORT_PRICE_INVALID');
  expect(refused(parseServiceImportPriceCell(text('100000000000.000')))).toBe(
    'IMPORT_PRICE_INVALID',
  );
});

it('SI-FR005-5 refuses a fourth decimal instead of rounding it', () => {
  expect(refused(parseServiceImportPriceCell(text('7.5555')))).toBe('IMPORT_PRICE_INVALID');
  expect(refused(parseServiceImportPriceCell(text('0.0001')))).toBe('IMPORT_PRICE_INVALID');
  expect(refused(parseServiceImportPriceCell(numeric('7.5555')))).toBe('IMPORT_PRICE_INVALID');
});

it.each([
  ['a negative value', '-1'],
  ['a negative fraction', '-0.500'],
  ['exponent form', '1e21'],
  ['exponent form with a sign', '1e+21'],
  ['a thousands separator', '1,234'],
  ['a space separator', '1 234'],
  ['non-ASCII digits', '١٢'],
  ['a leading zero', '01.500'],
  ['a trailing dot', '12.'],
])('SI-FR005-6 refuses %s', (_label, value) => {
  expect(refused(parseServiceImportPriceCell(text(value)))).toBe('IMPORT_PRICE_INVALID');
  expect(refused(parseServiceImportPriceCell(numeric(value)))).toBe('IMPORT_PRICE_INVALID');
});

it('SI-FR005-7 refuses a numeric cell the reader could not represent', () => {
  const cell: ServiceImportTaggedCell = { kind: 'numeric-unrepresentable', display: '1e21' };
  expect(refused(parseServiceImportPriceCell(cell))).toBe('IMPORT_PRICE_INVALID');
});

it('SI-FR005-8 refuses a boolean cell', () => {
  const cell: ServiceImportTaggedCell = { kind: 'boolean', value: true };
  expect(refused(parseServiceImportPriceCell(cell))).toBe('IMPORT_PRICE_INVALID');
});

it('SI-FR005-9 reads the price text without commission percentage scaling', () => {
  expect(parseServiceImportPriceCell(numeric('0.2', true))).toEqual({
    ok: true,
    price: '0.200',
    mills: 200n,
  });
  expect(parseServiceImportPriceCell(numeric('20', true))).toEqual({
    ok: true,
    price: '20.000',
    mills: 20000n,
  });
});

it('SI-FR005-10 refuses an Excel error cell and never defaults it', () => {
  const cell = Object.freeze({ kind: 'error' } as const);
  const result = parseServiceImportPriceCell(cell);
  expect(result.ok).toBe(false);
  expect(refused(result)).toBe('IMPORT_CELL_INVALID');
  expect(cell).toEqual({ kind: 'error' });
});

it('SI-FR005-11 refuses a blank required cell', () => {
  expect(refused(parseServiceImportPriceCell(null))).toBe('IMPORT_REQUIRED_CELL');
  expect(refused(parseServiceImportPriceCell(text('')))).toBe('IMPORT_REQUIRED_CELL');
  expect(refused(parseServiceImportPriceCell(text('   ')))).toBe('IMPORT_REQUIRED_CELL');
});

it('SI-FR005-12 refuses a raw number instead of stringifying it', () => {
  const raw = 12.5 as unknown as ServiceImportTaggedCell;
  const result = parseServiceImportPriceCell(raw);
  expect(result.ok).toBe(false);
  expect(refused(result)).toBe('IMPORT_CELL_INVALID');
  expect(JSON.stringify(result)).not.toContain('12.5');
});

it('SI-FR005-13 refuses a cell of an unknown kind', () => {
  const cell = { kind: 'money' } as unknown as ServiceImportTaggedCell;
  expect(refused(parseServiceImportPriceCell(cell))).toBe('IMPORT_CELL_INVALID');
});

it('SI-FR005-14 leaves the tagged cell untouched', () => {
  const cell = Object.freeze({ kind: 'text', text: '12.5' } as const);
  expect(parseServiceImportPriceCell(cell)).toEqual({
    ok: true,
    price: '12.500',
    mills: 12_500n,
  });
  expect(cell).toEqual({ kind: 'text', text: '12.5' });
});
