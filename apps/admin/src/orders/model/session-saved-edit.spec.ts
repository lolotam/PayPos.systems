import { expect, it } from 'vitest';
import { applySavedLineEdit, emptySavedVisit, reconcileSavedVisit, savedLineFigures, type SavedVisitEdit } from './session-saved-edit';

const fresh = { price: '4.250', discount: '0.250', net: '4.000' };

function editedVisit(): SavedVisitEdit {
  return {
    sessionId: 's1', total: 'UNKNOWN', totalNet: '6.412',
    lines: {
      l1: { edited: true, revision: 5, figures: 'UNKNOWN' },
      l2: { edited: true, revision: 2, figures: 'FROM_RESPONSE', price: '9.500', discount: '1.000', net: '8.500' },
      gone: { edited: true, revision: 4, figures: 'UNKNOWN' },
    },
  };
}

const snapshot = (lines: { id: string; revision: number }[], total = '6.250') => ({ id: 's1', total_net: total, lines });

it('does not let a late replay response overwrite figures of a newer snapshot revision', () => {
  const newer: SavedVisitEdit = { sessionId: 's1', total: 'SNAPSHOT', totalNet: '9.000', lines: { l1: { edited: true, revision: 4, figures: 'SNAPSHOT' } } };
  const wide = applySavedLineEdit(newer, 's1', 'l1', { saved: true, edited: true } as never, 1);
  expect(wide).toBe(newer);
  const old = { line: { revision: 2, price: '1.000', discount: '0.000', net: '1.000' }, session: { total_net: '1.000' } } as never;
  expect(applySavedLineEdit(newer, 's1', 'l1', old, 1)).toBe(newer);
  const equal = { line: { revision: 4, price: '3.000', discount: '0.000', net: '3.000' }, session: { total_net: '3.000' } } as never;
  expect(applySavedLineEdit(newer, 's1', 'l1', equal, 3)).toBe(newer);
  const current = { line: { revision: 5, price: '2.000', discount: '0.000', net: '2.000' }, session: { total_net: '2.000' } } as never;
  expect(applySavedLineEdit(newer, 's1', 'l1', current, 4).lines.l1).toMatchObject({ revision: 5, figures: 'FROM_RESPONSE', net: '2.000' });
});

it('keeps the hidden figures when the snapshot revision is older than the confirmed edit', () => {
  const next = reconcileSavedVisit(editedVisit(), snapshot([{ id: 'l1', revision: 4 }, { id: 'l2', revision: 1 }]));
  expect(next.lines.l1).toEqual({ edited: true, revision: 5, figures: 'UNKNOWN' });
  expect(next.lines.l2).toEqual(editedVisit().lines.l2);
  expect(next.lines.gone).toBeUndefined();
  expect(savedLineFigures(fresh, next.lines.l1)).toBeNull();
  expect(next.total).toBe('UNKNOWN');
  const priced = reconcileSavedVisit({
    sessionId: 's1', total: 'FROM_RESPONSE', totalNet: '8.500',
    lines: { l2: { edited: true, revision: 2, figures: 'FROM_RESPONSE', price: '9.500', discount: '1.000', net: '8.500' } },
  }, snapshot([{ id: 'l2', revision: 1 }], '1.000'));
  expect(priced.lines.l2?.figures).toBe('FROM_RESPONSE');
  expect(priced.total).toBe('UNKNOWN');
  expect(priced.totalNet).toBe('8.500');
});

it('shows the snapshot figures when its revision is equal or newer', () => {
  const next = reconcileSavedVisit({
    sessionId: 's1', total: 'FROM_RESPONSE', totalNet: '8.500',
    lines: {
      equal: { edited: true, revision: 4, figures: 'FROM_RESPONSE', price: '9.500', discount: '1.000', net: '8.500' },
      newer: { edited: true, revision: 2, figures: 'UNKNOWN' },
    },
  }, snapshot([{ id: 'equal', revision: 4 }, { id: 'newer', revision: 6 }], '11.000'));
  expect(next.lines.equal).toEqual({ edited: true, revision: 4, figures: 'SNAPSHOT' });
  expect(next.lines.newer).toEqual({ edited: true, revision: 6, figures: 'SNAPSHOT' });
  expect(next).toMatchObject({ total: 'SNAPSHOT', totalNet: '11.000' });
  expect(savedLineFigures(fresh, next.lines.equal)).toEqual(fresh);
  expect(savedLineFigures(fresh, next.lines.newer)).toEqual(fresh);
});

it('keeps the visit total unknown while an uncovered edit remains', () => {
  const next = reconcileSavedVisit(editedVisit(), snapshot([{ id: 'l1', revision: 3 }, { id: 'l2', revision: 4 }]));
  expect(next.lines.l1?.figures).toBe('UNKNOWN');
  expect(next.lines.l2).toEqual({ edited: true, revision: 4, figures: 'SNAPSHOT' });
  expect(next.total).toBe('UNKNOWN');
  expect(next.totalNet).toBe('6.412');
  expect(savedLineFigures({ price: '2.000', discount: '0.000', net: '2.000' }, next.lines.l2)).toEqual({ price: '2.000', discount: '0.000', net: '2.000' });
  const dropped = reconcileSavedVisit(editedVisit(), snapshot([{ id: 'l2', revision: 4 }]));
  expect(dropped.lines.l1).toBeUndefined();
  expect(dropped.lines.l2?.figures).toBe('SNAPSHOT');
  expect(dropped.total).toBe('UNKNOWN');
});

it('starts clean for a different session id', () => {
  expect(reconcileSavedVisit(editedVisit(), { id: 's2', total_net: '1.400', lines: [{ id: 'l1', revision: 9 }] })).toEqual(emptySavedVisit('s2', '1.400'));
});
