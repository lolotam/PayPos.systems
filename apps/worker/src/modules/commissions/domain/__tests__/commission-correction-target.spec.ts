import { expect, it } from 'vitest';

import { CommissionCorrectionTargetInputError } from '../errors.ts';

import {
  selectCommissionCorrectionTarget,
  type CommissionCorrectionCandidate,
} from '../commission-correction-target.ts';

const row = (
  period: string,
  status: CommissionCorrectionCandidate['status'],
  statementId = `statement-${period}`,
): CommissionCorrectionCandidate => ({ period, statementId, status });

const pick = (
  snapshot: readonly CommissionCorrectionCandidate[],
  sourcePeriod = '2026-09',
  currentPeriod = '2026-12',
): CommissionCorrectionCandidate | null =>
  selectCommissionCorrectionTarget(snapshot, sourcePeriod, currentPeriod);

it('picks the earliest DRAFT period rather than the first row of the snapshot', () => {
  expect(pick([row('2026-11', 'DRAFT'), row('2026-10', 'DRAFT')])?.period).toBe('2026-10');
});

it('decides by the smallest period and not by the order of the rows', () => {
  const rows = [row('2026-11', 'DRAFT'), row('2026-10', 'DRAFT'), row('2026-12', 'DRAFT')];
  expect(pick(rows)?.period).toBe('2026-10');
  expect(pick([...rows].reverse())?.period).toBe('2026-10');
});

it('skips a REVIEWED month and takes the next DRAFT', () => {
  expect(pick([row('2026-10', 'REVIEWED'), row('2026-11', 'DRAFT')])?.period).toBe('2026-11');
});

it('skips an APPROVED month and takes the next DRAFT', () => {
  expect(pick([row('2026-10', 'APPROVED'), row('2026-11', 'DRAFT')])?.period).toBe('2026-11');
});

it('skips a PAID month and takes the next DRAFT', () => {
  expect(pick([row('2026-10', 'PAID'), row('2026-11', 'DRAFT')])?.period).toBe('2026-11');
});

it('skips every closed or reviewed month and keeps the only DRAFT', () => {
  const snapshot = [
    row('2026-09', 'PAID'),
    row('2026-10', 'APPROVED'),
    row('2026-11', 'REVIEWED'),
    row('2026-12', 'DRAFT'),
  ];
  expect(pick(snapshot)?.period).toBe('2026-12');
});

it('never picks the source month itself', () => {
  const snapshot = [row('2026-09', 'DRAFT'), row('2026-10', 'DRAFT')];
  expect(pick(snapshot, '2026-09', '2026-12')?.period).toBe('2026-10');
});

it('never picks a month before the source', () => {
  const snapshot = [row('2026-07', 'DRAFT'), row('2026-08', 'DRAFT'), row('2026-10', 'DRAFT')];
  expect(pick(snapshot, '2026-09', '2026-12')?.period).toBe('2026-10');
});

it('never picks a month after the current business period', () => {
  const snapshot = [row('2026-10', 'DRAFT'), row('2026-12', 'DRAFT'), row('2027-01', 'DRAFT')];
  expect(pick(snapshot, '2026-09', '2026-11')?.period).toBe('2026-10');
});

it('picks the current business period when it is the only DRAFT', () => {
  expect(pick([row('2026-11', 'DRAFT')], '2026-09', '2026-11')?.period).toBe('2026-11');
});

it('returns null for an empty snapshot', () => {
  expect(pick([])).toBeNull();
});

it('returns null when every month is closed or reviewed', () => {
  const snapshot = [row('2026-10', 'APPROVED'), row('2026-11', 'PAID'), row('2026-12', 'REVIEWED')];
  expect(pick(snapshot)).toBeNull();
});

it('returns null when the source month is the current business period', () => {
  expect(pick([row('2026-11', 'DRAFT')], '2026-11', '2026-11')).toBeNull();
});

it.each(['2026-13', '2026-1', '26-01', '0000-01', '2026-00', 'not-a-month', ''])(
  'rejects the invalid source month %s',
  (sourcePeriod) => {
    expect(() => pick([row('2026-10', 'DRAFT')], sourcePeriod, '2026-12')).toThrowError(
      expect.objectContaining({ reason: 'INVALID_SOURCE_PERIOD' }),
    );
  },
);

it.each(['2026-13', '2026-1', '26-01', '0000-01', ''])(
  'rejects the invalid current business period %s',
  (currentPeriod) => {
    expect(() => pick([row('2026-10', 'DRAFT')], '2026-09', currentPeriod)).toThrowError(
      expect.objectContaining({ reason: 'INVALID_CURRENT_PERIOD' }),
    );
  },
);

it.each(['2026-13', '2026-1', '26-01', '0000-01', ''])(
  'rejects the invalid candidate month %s',
  (period) => {
    expect(() => pick([row(period, 'DRAFT')])).toThrowError(
      expect.objectContaining({ reason: 'INVALID_CANDIDATE_PERIOD' }),
    );
  },
);

it.each(['   ', '', null, undefined, 42])('rejects invalid statement id %s', (statementId) => {
  const snapshot = [{ period: '2026-10', status: 'DRAFT', statementId }];
  expect(() => pick(snapshot as unknown as CommissionCorrectionCandidate[])).toThrowError(
    expect.objectContaining({ reason: 'MISSING_STATEMENT_ID' }),
  );
});

it('rejects a candidate row with an unknown status', () => {
  const snapshot = [{ period: '2026-10', statementId: 'statement-2026-10', status: 'SETTLED' }];
  expect(() => pick(snapshot as unknown as CommissionCorrectionCandidate[])).toThrowError(
    expect.objectContaining({ reason: 'UNKNOWN_STATUS' }),
  );
});

it('rejects an ambiguous duplicate period with a different statement id', () => {
  const snapshot = [row('2026-10', 'DRAFT', 'statement-a'), row('2026-10', 'DRAFT', 'statement-b')];
  expect(() => pick(snapshot)).toThrowError(
    expect.objectContaining({ reason: 'AMBIGUOUS_DUPLICATE_PERIOD' }),
  );
});

it('rejects an ambiguous duplicate period with a different status', () => {
  const snapshot = [
    row('2026-10', 'DRAFT', 'statement-a'),
    row('2026-10', 'APPROVED', 'statement-a'),
  ];
  expect(() => pick(snapshot)).toThrowError(
    expect.objectContaining({ reason: 'AMBIGUOUS_DUPLICATE_PERIOD' }),
  );
});

it('tolerates a repeated identical row because it decides nothing on its own', () => {
  const repeated = row('2026-10', 'DRAFT');
  expect(pick([repeated, repeated])?.period).toBe('2026-10');
});

it('refuses an ambiguous snapshot with the local typed error', () => {
  expect(() => pick([row('2026-10', 'DRAFT'), row('2026-10', 'DRAFT', 'other')])).toThrow(
    CommissionCorrectionTargetInputError,
  );
});

it('does not mutate or reorder the supplied snapshot', () => {
  const snapshot = Object.freeze([
    Object.freeze(row('2026-11', 'DRAFT')),
    Object.freeze(row('2026-10', 'DRAFT')),
  ]);
  expect(pick(snapshot)?.period).toBe('2026-10');
  expect(snapshot.map((entry) => entry.period)).toEqual(['2026-11', '2026-10']);
});

it('leaves every status untouched, including the REVIEWED month it skipped', () => {
  const snapshot = [
    row('2026-10', 'REVIEWED'),
    row('2026-11', 'DRAFT'),
    row('2026-12', 'APPROVED'),
  ];
  pick(snapshot);
  expect(snapshot.map((entry) => entry.status)).toEqual(['REVIEWED', 'DRAFT', 'APPROVED']);
});

it('returns the supplied row itself instead of a synthesised one', () => {
  const draft = row('2026-10', 'DRAFT');
  const selected = pick([row('2026-11', 'DRAFT'), draft]);
  expect(selected).toBe(draft);
});
