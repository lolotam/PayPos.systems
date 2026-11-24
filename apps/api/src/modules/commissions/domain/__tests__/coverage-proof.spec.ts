import { describe, expect, it } from 'vitest';

import {
  coverageProofAdmits,
  isCoverageProofValid,
  type ExpectedCoverageRules,
  type StoredCoverageProof,
} from '../coverage-proof.ts';

const BUSINESS = '0198aaaa-0000-7000-8000-000000000001';
const OTHER_BUSINESS = '0198aaaa-0000-7000-8000-000000000002';
const TYPES = [
  'ServiceSessionRecorded',
  'ServiceSessionLinesAdded',
  'ServiceLineChanged',
  'SessionTipsChanged',
  'SalaryChanged',
  'PackageSaleChanged',
];

const rules: ExpectedCoverageRules = {
  version: 1,
  countedTypes: TYPES,
  consumerId: 'commissions.project-inputs',
  databaseName: 'pospay_staging',
  systemId: '7301234567890123456',
};

function proof(overrides: Partial<StoredCoverageProof> = {}): StoredCoverageProof {
  return {
    version: 1,
    businessIds: [BUSINESS],
    tipFrom: '2026-01-01',
    tipTo: '2026-11-23',
    tipDayBound: '2026-11-23',
    countedTypes: [...TYPES].reverse(),
    consumerId: 'commissions.project-inputs',
    databaseName: 'pospay_staging',
    systemId: '7301234567890123456',
    ...overrides,
  };
}

describe('isCoverageProofValid (ADR-0054 §5)', () => {
  it('accepts a proof that matches the version, types, consumer and database, whatever the type order', () => {
    expect(isCoverageProofValid(proof(), rules)).toBe(true);
  });

  it.each([
    { name: 'another version', change: { version: 2 } },
    { name: 'another database name', change: { databaseName: 'pospay_other' } },
    { name: 'another cluster system id', change: { systemId: '1' } },
    { name: 'another consumer id', change: { consumerId: 'commissions.other' } },
    { name: 'a narrower type list', change: { countedTypes: TYPES.slice(1) } },
    { name: 'a wider type list', change: { countedTypes: [...TYPES, 'OrderCompleted'] } },
    { name: 'a swapped type', change: { countedTypes: [...TYPES.slice(1), 'OrderCompleted'] } },
  ])('rejects $name', ({ change }) => {
    expect(isCoverageProofValid(proof(change), rules)).toBe(false);
  });
});

describe('coverageProofAdmits (ADR-0054 §6, the boundary table)', () => {
  const cases: [string, string, string, string, boolean, string][] = [
    // [U, month, tip_from, tip_to, admitted, why]
    ['2026-11-23', '2026-10', '2026-01-01', '2026-11-23', true, 'October, min(L, U) = 10-31'],
    [
      '2026-11-23',
      '2026-11',
      '2026-01-01',
      '2026-11-23',
      true,
      'the bootstrap month needs tip_to >= 11-23',
    ],
    ['2026-11-23', '2026-11', '2026-01-01', '2026-11-22', false, 'day 11-23 unchecked'],
    ['2026-11-23', '2026-11', '2026-11-05', '2026-11-23', false, 'days 11-01 to 11-04 unchecked'],
    ['2026-11-23', '2026-10', '2026-10-15', '2026-11-23', false, 'October start unchecked'],
    [
      '2026-11-23',
      '2026-12',
      '2026-11-23',
      '2026-11-23',
      true,
      'December starts after U, any range',
    ],
    ['2026-12-01', '2026-12', '2026-01-01', '2026-12-01', true, 'December, min(L, U) = 12-01'],
    ['2026-12-01', '2027-01', '2026-12-01', '2026-12-01', true, 'January starts after U'],
    [
      '2026-11-23',
      '2026-09',
      '2026-10-01',
      '2026-11-23',
      false,
      'September starts before tip_from',
    ],
  ];

  it.each(cases)('U %s, month %s, range %s … %s → %s (%s)', (bound, month, from, to, admitted) => {
    const stored = proof({ tipDayBound: bound, tipFrom: from, tipTo: to });

    expect(coverageProofAdmits(stored, BUSINESS, month)).toBe(admitted);
  });

  it('refuses a business that is absent from the proof, even for a month after the bound', () => {
    expect(coverageProofAdmits(proof(), OTHER_BUSINESS, '2026-12')).toBe(false);
    expect(coverageProofAdmits(proof({ businessIds: [] }), BUSINESS, '2026-10')).toBe(false);
  });

  it('rejects a malformed month instead of guessing', () => {
    expect(() => coverageProofAdmits(proof(), BUSINESS, '2026-13')).toThrow(RangeError);
  });
});
