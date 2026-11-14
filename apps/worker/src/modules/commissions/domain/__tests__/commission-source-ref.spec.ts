import { describe, expect, it } from 'vitest';

import type { CommissionTipMethod } from '../commission-tip-salary-inputs.ts';

import {
  COMMISSION_LINE_SOURCE_PREFIX,
  COMMISSION_SALE_SOURCE_PREFIX,
  COMMISSION_TIP_SOURCE_PREFIX,
  commissionLineSourceRef,
  commissionSourceKind,
  commissionTipSourceRef,
} from '../commission-source-ref.ts';

describe('commission source prefixes', () => {
  it.each([
    ['line', COMMISSION_LINE_SOURCE_PREFIX, 'line:'],
    ['sale', COMMISSION_SALE_SOURCE_PREFIX, 'sale:'],
    ['tip', COMMISSION_TIP_SOURCE_PREFIX, 'tip:'],
  ])('uses the canonical %s prefix', (_kind, prefix, expected) => {
    expect(prefix).toBe(expected);
  });
});

describe('commissionLineSourceRef', () => {
  it.each([
    ['ordinary', 'line-123'],
    ['mixed-case', 'LiNe-AbC'],
    ['whitespace-padded', ' line-123 '],
    ['separator-containing', 'sale:line:123'],
    ['unicode', 'بند-١'],
    ['empty', ''],
  ])('passes an %s id through without normalisation', (_label, lineId) => {
    expect(commissionLineSourceRef(lineId)).toBe(`line:${lineId}`);
  });
});

describe('commissionTipSourceRef', () => {
  it.each(['CARD', 'CASH'] as const)('includes the %s payment method', (method) => {
    expect(commissionTipSourceRef('session-123', method)).toBe(`tip:session-123:${method}`);
  });

  it.each([
    ['mixed-case', 'SeSsIoN-AbC'],
    ['whitespace-padded', ' session-123 '],
    ['separator-containing', 'sale:session:123'],
    ['unicode', 'جلسة-١'],
    ['empty', ''],
  ])('passes an %s session id through without normalisation', (_label, sessionId) => {
    expect(commissionTipSourceRef(sessionId, 'CARD')).toBe(`tip:${sessionId}:CARD`);
  });
});

describe('commissionSourceKind', () => {
  it.each([
    ['a line ref', 'line:line-123', 'COMMISSION'],
    ['a sale ref', 'sale:sale-123', 'SALE'],
    ['a CARD tip ref', 'tip:session-123:CARD', 'TIP_CARD'],
    ['a CASH tip ref', 'tip:session-123:CASH', 'TIP_CASH'],
    ['a tip ref with an unexpected suffix', 'tip:session-123:TRANSFER', 'TIP_CARD'],
    ['an empty ref', '', 'COMMISSION'],
    ['an unknown prefix', 'other:source-123', 'COMMISSION'],
    ['a capitalised line lookalike', 'Line:line-123', 'COMMISSION'],
    ['a plural line lookalike', 'lines:line-123', 'COMMISSION'],
    ['a leading-space line lookalike', ' line:line-123', 'COMMISSION'],
  ])('classifies %s according to the source contract', (_label, sourceRef, expected) => {
    expect(commissionSourceKind(sourceRef)).toBe(expected);
  });

  it.each([
    ['CARD', 'TIP_CARD'],
    ['CASH', 'TIP_CASH'],
  ] as const)('round-trips a %s tip ref to its correction kind', (method, expected) => {
    const ref = commissionTipSourceRef('session-123', method satisfies CommissionTipMethod);
    expect(commissionSourceKind(ref)).toBe(expected);
  });

  it.each(['line-123', 'LiNe-AbC', ' line-123 ', ''])(
    'round-trips the line ref for %j to COMMISSION',
    (lineId) => {
      expect(commissionSourceKind(commissionLineSourceRef(lineId))).toBe('COMMISSION');
    },
  );
});
