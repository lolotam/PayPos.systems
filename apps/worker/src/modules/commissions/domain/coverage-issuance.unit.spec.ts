import { expect, it } from 'vitest';

import { assertIssuableCoverage, assertSamePrimary } from './coverage-issuance.ts';

const primary = (over: Partial<Parameters<typeof assertSamePrimary>[0]> = {}) => ({
  databaseName: 'pospay_test',
  systemId: '42',
  inRecovery: false,
  ...over,
});

it('accepts two connections reporting the same primary identity', () => {
  expect(() => assertSamePrimary(primary(), primary())).not.toThrow();
});

it('refuses a standby connection on either side even with identical identity', () => {
  expect(() => assertSamePrimary(primary({ inRecovery: true }), primary())).toThrow(
    'COVERAGE_REPLICA_REFUSED',
  );
  expect(() => assertSamePrimary(primary(), primary({ inRecovery: true }))).toThrow(
    'COVERAGE_REPLICA_REFUSED',
  );
});

it('refuses a different database name or cluster system identifier', () => {
  expect(() => assertSamePrimary(primary(), primary({ databaseName: 'other' }))).toThrow(
    'COVERAGE_DATABASE_MISMATCH',
  );
  expect(() => assertSamePrimary(primary(), primary({ systemId: '7' }))).toThrow(
    'COVERAGE_DATABASE_MISMATCH',
  );
});

const covered = () => {
  const section = () => ({ missing: { total: 0 }, stale: { total: 0 } });
  return {
    status: 'COVERED',
    truncated: false,
    lines: section(),
    salaries: section(),
    sales: section(),
    tips: section(),
    unmarked: { total: 0 },
    notHandled: { total: 0 },
  };
};

it('accepts only a complete report with all four source checks', () => {
  expect(() => assertIssuableCoverage(covered())).not.toThrow();
});

it.each(['lines', 'salaries', 'sales', 'tips'] as const)(
  'refuses a gap or stale revision in %s despite COVERED',
  (key) => {
    for (const problem of ['missing', 'stale'] as const) {
      const report = covered();
      report[key][problem].total = 1;
      expect(() => assertIssuableCoverage(report)).toThrow('COVERAGE_REPORT_NOT_COVERED');
    }
  },
);

it.each([
  { status: 'NOT_COVERED' },
  { truncated: true },
  { tips: null },
  { unmarked: { total: 1 } },
  { notHandled: { total: 1 } },
])('refuses an incomplete report: %j', (change) => {
  expect(() => assertIssuableCoverage({ ...covered(), ...change })).toThrow(
    'COVERAGE_REPORT_NOT_COVERED',
  );
});
