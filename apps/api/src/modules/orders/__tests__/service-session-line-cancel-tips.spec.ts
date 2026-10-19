import { afterAll, beforeAll, expect, it } from 'vitest';
import { holdVisit, recordVisit, runTips, tip, tipInput, tipRows, twoLines, waitForAdvisory } from '../../../../test/session-tips.fixture.ts';
import { ids, must } from './session.fixture.ts';
import { cancelFixture, cancelInput, cancelQuiet, cancelRows, runCancel, type CancelFixture } from './line-cancel.helpers.ts';

let f: CancelFixture;
beforeAll(async () => { f = await cancelFixture(); });
afterAll(async () => { await f?.close(); });

it('LC-14 cancelling the only tipped line is blocked and writes nothing', async () => {
  const visit = await recordVisit(f);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.500')]));
  const lineId = must(visit.lineIds[0]);
  const key = ids.newId();
  const error = await runCancel(f, visit.sessionId, lineId, cancelInput(), { key }).then(() => null, (caught: unknown) => caught);
  expect(error).toMatchObject({ code: 'SESSION_CANCEL_BLOCKED_BY_TIP', details: { employee_ids: [must(f.employees[0])] } });
  expect(Object.keys((error as { details: object }).details)).toEqual(['employee_ids']);
  expect(JSON.stringify((error as { details: object }).details)).not.toMatch(/\d\.\d{3}/);
  expect(await cancelQuiet(f, visit.sessionId, lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
});

it('LC-15 replacing the tip set without the performer lets the same cancel succeed', async () => {
  const visit = await recordVisit(f, twoLines(f));
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000'), tip(f, 1, 'CARD', '2.000')]));
  await runTips(f, visit.sessionId, tipInput([tip(f, 1, 'CARD', '2.000')], { expected_revision: 1, reason: 'drop the first' }));
  const saved = await runCancel(f, visit.sessionId, must(visit.lineIds[0]));
  expect(saved).toMatchObject({ line: { status: 'CANCELLED' }, session: { total_net: '7.125' } });
});

it('LC-16 another active line for the tipped performer keeps the tip', async () => {
  const first = f.line(must(f.services[0]), '25.000', '0.000');
  const second = f.line(must(f.services[1]), '7.125', '0.000');
  const visit = await recordVisit(f, [first, second]);
  await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  const saved = await runCancel(f, visit.sessionId, must(visit.lineIds[0]));
  expect(saved).toMatchObject({ line: { status: 'CANCELLED' }, session: { total_net: '7.125' } });
  const rows = await tipRows(f, visit.sessionId);
  expect(rows.revisions).toHaveLength(1);
  expect(rows.entries).toEqual([expect.objectContaining({ employee_id: must(f.employees[0]), method: 'CASH', amount: '1.000' })]);
});

it('LC-17 an empty latest tip set does not block, and cash-only or card-only does', async () => {
  const cleared = await recordVisit(f);
  await runTips(f, cleared.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]));
  await runTips(f, cleared.sessionId, tipInput([], { expected_revision: 1, reason: 'clear the set' }));
  expect(await runCancel(f, cleared.sessionId, must(cleared.lineIds[0]))).toMatchObject({ line: { status: 'CANCELLED' } });
  for (const method of ['CASH', 'CARD'] as const) {
    const visit = await recordVisit(f);
    await runTips(f, visit.sessionId, tipInput([tip(f, 0, method, '1.000')]));
    await expect(runCancel(f, visit.sessionId, must(visit.lineIds[0]))).rejects.toThrow('SESSION_CANCEL_BLOCKED_BY_TIP');
  }
});

it('LC-18 a tip and a cancel of the last line commit exactly one, and the loser matches the winner', async () => {
  const visit = await recordVisit(f);
  const lineId = must(visit.lineIds[0]);
  const held = await holdVisit(f, visit.sessionId);
  const pending = Promise.allSettled([
    runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), { key: ids.newId(), fingerprint: 'e'.repeat(64) }),
    runCancel(f, visit.sessionId, lineId, cancelInput(), { key: ids.newId(), fingerprint: 'f'.repeat(64) }),
  ]);
  try { expect(await waitForAdvisory(f, held.pid, 2)).toBeGreaterThanOrEqual(2); }
  finally { await held.release(); }
  const [tipOutcome, cancelOutcome] = await pending;
  expect([tipOutcome, cancelOutcome].filter((item) => item?.status === 'fulfilled')).toHaveLength(1);
  if (cancelOutcome?.status === 'fulfilled') {
    expect(tipOutcome?.status).toBe('rejected');
    if (tipOutcome?.status === 'rejected') expect(tipOutcome.reason).toMatchObject({ code: 'TIP_EMPLOYEE_NOT_PERFORMER' });
    const tips = await tipRows(f, visit.sessionId);
    expect(tips.revisions).toEqual([]);
    expect(tips.entries).toEqual([]);
    expect((await cancelRows(f, visit.sessionId, lineId)).cancellations).toHaveLength(1);
    return;
  }
  expect(tipOutcome?.status).toBe('fulfilled');
  expect(cancelOutcome?.status).toBe('rejected');
  if (cancelOutcome?.status === 'rejected') expect(cancelOutcome.reason).toMatchObject({ code: 'SESSION_CANCEL_BLOCKED_BY_TIP' });
  expect((await cancelRows(f, visit.sessionId, lineId)).cancellations).toHaveLength(0);
  const tips = await tipRows(f, visit.sessionId);
  expect(tips.revisions.length).toBeGreaterThan(0);
  expect(tips.entries.length).toBeGreaterThan(0);
}, 20_000);
