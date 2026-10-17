import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  errorShape,
  holdVisit,
  recordVisit,
  runTips,
  tip,
  tipFixture,
  tipInput,
  tipRows,
  waitForAdvisory,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
beforeAll(async () => {
  f = await tipFixture();
});
afterAll(async () => {
  await f?.close();
});

it('TP-11 two concurrent replacements leave one winner and a continuous chain', async () => {
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  const held = await holdVisit(f, visit.sessionId);
  const pending = Promise.allSettled([
    runTips(
      f,
      visit.sessionId,
      tipInput([tip(f, 0, 'CASH', '2.000')], { expected_revision: 1, reason: 'first racer' }),
      { fingerprint: 'c'.repeat(64) },
    ),
    runTips(
      f,
      visit.sessionId,
      tipInput([tip(f, 0, 'CASH', '3.000')], { expected_revision: 1, reason: 'second racer' }),
      { fingerprint: 'd'.repeat(64) },
    ),
  ]);
  try {
    expect(await waitForAdvisory(f, 2)).toBeGreaterThanOrEqual(2);
  } finally {
    await held.release();
  }
  const outcomes = await pending;
  const rejected = outcomes.find((item) => item.status === 'rejected');
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  expect(errorShape(rejected?.status === 'rejected' ? rejected.reason : null).code).toBe(
    'TIP_REVISION_CONFLICT',
  );
  const rows = await tipRows(f, visit.sessionId);
  expect(rows.revisions.map((row) => [row['revision'], row['previous_revision']])).toEqual([
    [1, null],
    [2, 1],
  ]);
});

it('a tip write waits on the same visit lock a cancellation would hold', async () => {
  const visit = await recordVisit(f);
  const held = await holdVisit(f, visit.sessionId);
  const pending = runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  try {
    expect(await waitForAdvisory(f, 1)).toBeGreaterThanOrEqual(1);
    await held.release();
    expect((await pending).revision).toBe(1);
  } finally {
    await held.release();
    await pending.then(
      () => undefined,
      () => undefined,
    );
  }
});
