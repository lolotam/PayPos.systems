import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyUpdates, collectRows } from './set-status.mjs';

const sample = () => ({
  updated: '2026-10-01',
  phases: [
    {
      code: 'P1',
      status: 'in_progress',
      gates: [{ code: 'P1-G1', status: 'not_started', ref: '' }],
    },
  ],
  tracks: [{ code: 'POS', items: [{ code: 'POS-1', status: 'not_started', ref: '' }] }],
  partner: [{ code: 'AS-01', status: 'not_started', ref: '' }],
});

test('collects rows at every depth', () => {
  assert.deepEqual(
    collectRows(sample()).map((row) => row.code),
    ['P1', 'P1-G1', 'POS-1', 'AS-01'],
  );
});

test('sets status and ref and bumps updated', () => {
  const roadmap = applyUpdates(
    sample(),
    [{ code: 'POS-1', status: 'done', ref: 'PR #1' }],
    '2026-10-18',
  );
  assert.equal(roadmap.tracks[0].items[0].status, 'done');
  assert.equal(roadmap.tracks[0].items[0].ref, 'PR #1');
  assert.equal(roadmap.updated, '2026-10-18');
});

test('an unknown code or status changes nothing', () => {
  const roadmap = sample();
  assert.throws(() =>
    applyUpdates(
      roadmap,
      [
        { code: 'POS-1', status: 'done' },
        { code: 'NOPE', status: 'done' },
      ],
      'x',
    ),
  );
  assert.throws(() => applyUpdates(roadmap, [{ code: 'POS-1', status: 'finished' }], 'x'));
  assert.equal(roadmap.tracks[0].items[0].status, 'not_started');
  assert.equal(roadmap.updated, '2026-10-01');
});
