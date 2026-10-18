import { expect, it } from 'vitest';
import { cancelBlockedByTip, type CancelTipLine } from '../line-cancel-tip.ts';

const lineId = 'line-1';
const otherId = 'line-2';
const only = [{ id: lineId }] satisfies CancelTipLine[];
const both = [{ id: lineId }, { id: otherId }] satisfies CancelTipLine[];

function performers(rows: readonly (readonly [string, readonly string[]])[]) {
  return new Map(rows);
}

it('blocks the performer of the only active line when the current tip set names her', () => {
  const blocked = cancelBlockedByTip(lineId, only, performers([[lineId, ['sara']]]), ['sara']);
  expect(blocked).toEqual(['sara']);
  expect(JSON.stringify(blocked)).not.toMatch(/amount|CASH|CARD|\d\.\d{3}/);
});

it('does not block a performer who still has another active line', () => {
  expect(
    cancelBlockedByTip(
      lineId,
      both,
      performers([
        [lineId, ['sara']],
        [otherId, ['sara']],
      ]),
      ['sara'],
    ),
  ).toEqual([]);
});

it('does not block when the latest tip set is empty', () => {
  expect(cancelBlockedByTip(lineId, only, performers([[lineId, ['sara']]]), [])).toEqual([]);
});

it('blocks a CASH-only entry and a CARD-only entry the same way, with no amounts', () => {
  const map = performers([[lineId, ['sara']]]);
  const cashOnly = cancelBlockedByTip(lineId, only, map, ['sara']);
  const cardOnly = cancelBlockedByTip(lineId, only, map, ['sara']);
  expect(cashOnly).toEqual(['sara']);
  expect(cardOnly).toEqual(cashOnly);
});

it('names only the performer who would be left without an active line', () => {
  expect(
    cancelBlockedByTip(
      lineId,
      both,
      performers([
        [lineId, ['heba', 'sara']],
        [otherId, ['heba']],
      ]),
      ['sara', 'heba'],
    ),
  ).toEqual(['sara']);
});

it('returns sorted unique ids and ignores a tipped employee who did not perform this line', () => {
  const blocked = cancelBlockedByTip(
    lineId,
    only,
    performers([[lineId, ['emp-b', 'emp-a', 'emp-a']]]),
    ['emp-b', 'emp-a', 'emp-a', 'emp-c'],
  );
  expect(blocked).toEqual(['emp-a', 'emp-b']);
});
