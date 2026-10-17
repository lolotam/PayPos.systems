import { expect, it } from 'vitest';
import { emptySavedVisit, reconcileSavedVisit, savedLineFigures, type SavedVisitEdit } from './session-saved-edit';

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

it('keeps edited marks and drops stale figures when the same visit snapshot is replaced', () => {
  const next = reconcileSavedVisit(editedVisit(), {
    id: 's1', total_net: '6.250', lines: [{ id: 'l1', revision: 3 }, { id: 'l2', revision: 4 }, { id: 'added', revision: 1 }],
  });
  expect(next).toEqual({
    sessionId: 's1', total: 'SNAPSHOT', totalNet: '6.250',
    lines: {
      l1: { edited: true, revision: 5, figures: 'SNAPSHOT' },
      l2: { edited: true, revision: 4, figures: 'SNAPSHOT' },
    },
  });
  expect(savedLineFigures(fresh, next.lines.l1)).toEqual(fresh);
  expect(savedLineFigures({ price: '2.000', discount: '0.000', net: '2.000' }, next.lines.l2)).toEqual({ price: '2.000', discount: '0.000', net: '2.000' });
});

it('starts clean for a different session id', () => {
  expect(reconcileSavedVisit(editedVisit(), { id: 's2', total_net: '1.400', lines: [{ id: 'l1', revision: 9 }] })).toEqual(emptySavedVisit('s2', '1.400'));
});
