import { expect, it } from 'vitest';
import { branchView, businessView, closedView } from '../../api/__tests__/statement-http';
import { statementVersion } from '../statement-version';

const REVIEWED = businessView({
  status: 'REVIEWED',
  reviewed_fingerprint: 'c'.repeat(64),
  reviewed_statement_fingerprint: 'd'.repeat(64),
});

it('gives the same version to two reads of the same statement', () => {
  expect(statementVersion(businessView())).toBe(statementVersion(businessView()));
});

it.each([
  ['the status', businessView({ status: 'REVIEWED' })],
  ['the generated flag', businessView({ generated: false })],
  ['the current input fingerprint', businessView({ current_fingerprint: 'e'.repeat(64) })],
  ['the current statement fingerprint', businessView({ current_statement_fingerprint: 'e'.repeat(64) })],
])('gives another version when %s differs', (_label, other) => {
  expect(statementVersion(other)).not.toBe(statementVersion(businessView()));
});

it('tells a re-review with other reviewed fingerprints from the review the user saw', () => {
  const reReviewed = { ...REVIEWED, reviewed_fingerprint: 'e'.repeat(64) };
  expect(statementVersion(reReviewed)).not.toBe(statementVersion(REVIEWED));
});

it('versions a closed month and a branch reading by their status alone', () => {
  expect(statementVersion(closedView())).not.toBe(statementVersion(closedView({ status: 'PAID' })));
  expect(statementVersion(branchView())).not.toBe(statementVersion(branchView({ status: 'REVIEWED' })));
});
