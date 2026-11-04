import { expect, it } from 'vitest';

import {
  parseServiceImportCommissionCells,
  type ServiceImportCommissionCell,
} from '../service-import-commission.ts';

const text = (value: string): ServiceImportCommissionCell => ({ kind: 'text', text: value });
const numeric = (value: string, percentFormat = false): ServiceImportCommissionCell => ({
  kind: 'numeric',
  text: value,
  percentFormat,
});
const errorCell = { kind: 'error' } as const;
const booleanCell = { kind: 'boolean', value: true } as const;
const unrepresentable = { kind: 'numeric-unrepresentable', display: '1e21' } as const;

it.each([null, text(''), text('  ')])('marks a blank kind as defaulted: %o', (kind) => {
  expect(parseServiceImportCommissionCells(kind, null)).toEqual({
    ok: true,
    rule: { kind: 'FOLLOW_PLAN' },
    defaulted: true,
  });
});

it.each(['follow_plan', ' FoLlOw_PlAn ', 'zero', ' ZeRo '])(
  'accepts kind casing without marking an explicit rule defaulted: %s',
  (kind) => {
    expect(parseServiceImportCommissionCells(text(kind), text(' '))).toEqual({
      ok: true,
      rule: { kind: kind.trim().toUpperCase() },
      defaulted: false,
    });
  },
);

it.each(['FOLLOW_PLAN', 'ZERO'])('%s refuses every nonblank value', (kind) => {
  for (const value of [text('0'), numeric('0'), booleanCell, unrepresentable]) {
    expect(parseServiceImportCommissionCells(text(kind), value)).toEqual({
      ok: false,
      errors: [{ column: 'commission_value', reason: 'VALUE_INVALID' }],
    });
  }
});

it.each(['PCT', 'FIXED'])('%s requires a value', (kind) => {
  for (const value of [null, text(''), text(' ')]) {
    expect(parseServiceImportCommissionCells(text(kind), value)).toEqual({
      ok: false,
      errors: [{ column: 'commission_value', reason: 'REQUIRED' }],
    });
  }
});

it.each([text('OTHER'), booleanCell, unrepresentable, numeric('1')])(
  'refuses an invalid kind: %o',
  (kind) => {
    expect(parseServiceImportCommissionCells(kind, null)).toEqual({
      ok: false,
      errors: [{ column: 'commission_rule', reason: 'RULE_INVALID' }],
    });
  },
);

it('keeps both spreadsheet errors on their own columns', () => {
  expect(parseServiceImportCommissionCells(errorCell, errorCell)).toEqual({
    ok: false,
    errors: [
      { column: 'commission_rule', reason: 'CELL_INVALID' },
      { column: 'commission_value', reason: 'CELL_INVALID' },
    ],
  });
});

it('never defaults an error kind or treats an error value as blank', () => {
  expect(parseServiceImportCommissionCells(errorCell, null)).toEqual({
    ok: false,
    errors: [{ column: 'commission_rule', reason: 'CELL_INVALID' }],
  });
  for (const kind of [null, text('FOLLOW_PLAN'), text('ZERO'), text('PCT'), text('FIXED')]) {
    expect(parseServiceImportCommissionCells(kind, errorCell)).toEqual({
      ok: false,
      errors: [{ column: 'commission_value', reason: 'CELL_INVALID' }],
    });
  }
  expect(parseServiceImportCommissionCells(booleanCell, errorCell)).toEqual({
    ok: false,
    errors: [
      { column: 'commission_value', reason: 'CELL_INVALID' },
      { column: 'commission_rule', reason: 'RULE_INVALID' },
    ],
  });
});

it.each([
  [text('20'), 2000n],
  [numeric('20'), 2000n],
  [text('12.5'), 1250n],
  [numeric('12.55'), 1255n],
  [numeric('0.2', true), 2000n],
  [numeric('0.125', true), 1250n],
  [numeric('0.07', true), 700n],
  [numeric('0.2'), 20n],
  [text('0.2'), 20n],
  [text('0'), 0n],
  [text('100'), 10000n],
  [text('100.00'), 10000n],
  [numeric('1', true), 10000n],
  [numeric('0', true), 0n],
  [numeric('0.0001', true), 1n],
  [numeric('0.20000', true), 2000n],
] as const)('converts PCT exactly: %o', (value, bps) => {
  expect(parseServiceImportCommissionCells(text('pCt'), value)).toEqual({
    ok: true,
    rule: { kind: 'PCT', value: bps },
    defaulted: false,
  });
});

it.each([
  text('12.555'),
  text('0.001'),
  text('100.01'),
  text('-1'),
  text('1e2'),
  text('1,000'),
  text('١٢'),
  text('20%'),
  text('+20'),
  text('.5'),
  text('NaN'),
  text('Infinity'),
  numeric('1e21'),
  numeric('0.00001', true),
  numeric('1.0001', true),
  booleanCell,
  unrepresentable,
])('refuses malformed, over-range or fractional-bps PCT: %o', (value) => {
  expect(parseServiceImportCommissionCells(text('PCT'), value)).toEqual({
    ok: false,
    errors: [{ column: 'commission_value', reason: 'VALUE_INVALID' }],
  });
});

it.each([
  [text('12.5'), 12500n],
  [numeric('12.5'), 12500n],
  [text('99999999999.999'), 99999999999999n],
  [text('0'), 0n],
  [text('0.001'), 1n],
  [numeric('0.2', true), 200n],
  [numeric('12.5', true), 12500n],
] as const)(
  'converts FIXED without a service-price cap or percentage scaling: %o',
  (value, mills) => {
    expect(parseServiceImportCommissionCells(text('fIxEd'), value)).toEqual({
      ok: true,
      rule: { kind: 'FIXED', value: mills },
      defaulted: false,
    });
  },
);

it.each([
  text('12.5000'),
  text('100000000000'),
  text('-0.001'),
  text('1e2'),
  text('1,000'),
  text('١٢'),
  numeric('1e21'),
  booleanCell,
  unrepresentable,
])('refuses invalid FIXED values: %o', (value) => {
  expect(parseServiceImportCommissionCells(text('FIXED'), value)).toEqual({
    ok: false,
    errors: [{ column: 'commission_value', reason: 'VALUE_INVALID' }],
  });
});

it('keeps PCT zero distinct from ZERO', () => {
  expect(parseServiceImportCommissionCells(text('PCT'), text('0'))).toEqual({
    ok: true,
    rule: { kind: 'PCT', value: 0n },
    defaulted: false,
  });
  expect(parseServiceImportCommissionCells(text('ZERO'), null)).toEqual({
    ok: true,
    rule: { kind: 'ZERO' },
    defaulted: false,
  });
});

it('accepts frozen inputs and never mutates either cell', () => {
  const kind = Object.freeze({ kind: 'text', text: ' pct ' } as const);
  const value = Object.freeze({ kind: 'numeric', text: '0.125', percentFormat: true } as const);
  const first = parseServiceImportCommissionCells(kind, value);
  expect(first).toEqual({
    ok: true,
    rule: { kind: 'PCT', value: 1250n },
    defaulted: false,
  });
  expect(parseServiceImportCommissionCells(kind, value)).toEqual(first);
  expect(kind).toEqual({ kind: 'text', text: ' pct ' });
  expect(value).toEqual({ kind: 'numeric', text: '0.125', percentFormat: true });
});
