import { describe, expect, it } from 'vitest';

import { employmentOverlapsMonth, type EmploymentDates } from '../employment-overlap.ts';

const dates = (overrides: Partial<EmploymentDates> = {}): EmploymentDates => ({
  hireDate: '2025-01-01',
  contractEnd: null,
  deletedOn: null,
  ...overrides,
});

describe('employmentOverlapsMonth: hire date', () => {
  it.each([
    { name: 'hired long before the month', hireDate: '2025-01-01', expected: true },
    { name: 'hired on the last day before the month', hireDate: '2026-09-30', expected: true },
    { name: 'hired on the first day of the month', hireDate: '2026-10-01', expected: true },
    { name: 'hired inside the month', hireDate: '2026-10-15', expected: true },
    { name: 'hired on the last day of the month', hireDate: '2026-10-31', expected: true },
    { name: 'hired on the first day after the month', hireDate: '2026-11-01', expected: false },
    { name: 'hired long after the month', hireDate: '2027-03-10', expected: false },
  ])('$name → $expected', ({ hireDate, expected }) => {
    expect(employmentOverlapsMonth(dates({ hireDate }), '2026-10')).toBe(expected);
  });
});

describe('employmentOverlapsMonth: contract end and deletion', () => {
  it.each([
    { name: 'no end at all (open-ended)', contractEnd: null, expected: true },
    { name: 'contract ended the day before the month', contractEnd: '2026-09-30', expected: false },
    { name: 'contract ended on the first day of the month', contractEnd: '2026-10-01', expected: true },
    { name: 'contract ended inside the month', contractEnd: '2026-10-20', expected: true },
    { name: 'contract ended on the last day of the month', contractEnd: '2026-10-31', expected: true },
    { name: 'contract ends after the month', contractEnd: '2026-12-31', expected: true },
  ])('$name → $expected', ({ contractEnd, expected }) => {
    expect(employmentOverlapsMonth(dates({ contractEnd }), '2026-10')).toBe(expected);
  });

  it.each([
    { name: 'deleted the day before the month', deletedOn: '2026-09-30', expected: false },
    { name: 'deleted on the first day of the month', deletedOn: '2026-10-01', expected: true },
    { name: 'deleted inside the month', deletedOn: '2026-10-12', expected: true },
    { name: 'deleted on the last day of the month', deletedOn: '2026-10-31', expected: true },
    { name: 'deleted after the month', deletedOn: '2026-11-02', expected: true },
  ])('$name → $expected', ({ deletedOn, expected }) => {
    expect(employmentOverlapsMonth(dates({ deletedOn }), '2026-10')).toBe(expected);
  });

  it('is refused when either the contract end or the deletion precedes the month, whatever the other says', () => {
    expect(
      employmentOverlapsMonth(dates({ contractEnd: '2026-12-31', deletedOn: '2026-09-15' }), '2026-10'),
    ).toBe(false);
    expect(
      employmentOverlapsMonth(dates({ contractEnd: '2026-09-15', deletedOn: '2026-12-31' }), '2026-10'),
    ).toBe(false);
  });

  it('keeps an employee hired and ended inside the same month', () => {
    expect(
      employmentOverlapsMonth(dates({ hireDate: '2026-10-05', contractEnd: '2026-10-06' }), '2026-10'),
    ).toBe(true);
  });
});

describe('employmentOverlapsMonth: month edges of the calendar', () => {
  it.each([
    { period: '2024-02', hireDate: '2024-02-29', expected: true },
    { period: '2024-02', hireDate: '2024-03-01', expected: false },
    { period: '2026-02', hireDate: '2026-02-28', expected: true },
    { period: '2026-02', hireDate: '2026-03-01', expected: false },
    { period: '2026-04', hireDate: '2026-04-30', expected: true },
    { period: '2026-12', hireDate: '2026-12-31', expected: true },
    { period: '2027-01', hireDate: '2026-12-31', expected: true },
    { period: '2026-12', hireDate: '2027-01-01', expected: false },
  ])('hired $hireDate against $period → $expected', ({ period, hireDate, expected }) => {
    expect(employmentOverlapsMonth(dates({ hireDate }), period)).toBe(expected);
  });

  it('keeps a contract that ends on the first day of March against leap February, and refuses one that ended in January', () => {
    expect(employmentOverlapsMonth(dates({ hireDate: '2024-01-01', contractEnd: '2024-03-01' }), '2024-02')).toBe(true);
    expect(employmentOverlapsMonth(dates({ hireDate: '2023-01-01', contractEnd: '2024-01-31' }), '2024-02')).toBe(false);
  });
});

describe('employmentOverlapsMonth: invalid input', () => {
  it.each(['2026-13', '2026-00', '0000-05', '2026-1', 'October', '2026-10-01'])(
    'refuses the period %s',
    (period) => {
      expect(() => employmentOverlapsMonth(dates(), period)).toThrow(RangeError);
    },
  );

  it.each([{ hireDate: '2026-10' }, { contractEnd: '31/10/2026' }, { deletedOn: 'yesterday' }])(
    'refuses a malformed date %o',
    (overrides) => {
      expect(() => employmentOverlapsMonth(dates(overrides), '2026-10')).toThrow(RangeError);
    },
  );
});
