import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  recordVisit,
  runTips,
  tip,
  tipFixture,
  tipInput,
  tipQuiet,
  tipRows,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';
import { ids, must } from './session.fixture.ts';
import { employeePerson, replacePerformers, type PerformerChangeHost } from './line-identity.helpers.ts';

let f: TipFixture;
beforeAll(async () => { f = await tipFixture(); });
afterAll(async () => { await f?.close(); });

it('TP-05 a performer removed from her only line keeps her carried tip while another entry changes', async () => {
  const visit = await twoPerformerVisit(f);
  const kept = tip(f, 0, 'CASH', '1.000');
  const other = tip(f, 1, 'CARD', '2.000');
  await runTips(f, visit.sessionId, tipInput([kept, other]));
  await removeFirst(f, visit);
  const replaced = await runTips(
    f,
    visit.sessionId,
    tipInput([kept, { ...other, amount: '3.000' }], { expected_revision: 1, reason: 'change the other' }),
  );
  expect(replaced.revision).toBe(2);
  expect(replaced.tips).toHaveLength(2);
  const rows = await tipRows(f, visit.sessionId);
  const second = String(must(rows.revisions.find((row) => row['revision'] === 2))['id']);
  const entries = rows.entries.filter((entry) => entry['revision_id'] === second);
  expect(entries).toHaveLength(2);
  expect(entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ employee_id: must(f.employees[0]), method: 'CASH', amount: '1.000' }),
      expect.objectContaining({ employee_id: must(f.employees[1]), method: 'CARD', amount: '3.000' }),
    ]),
  );
});

it('TP-04 her linked user cannot change or remove her entry and nothing is written', async () => {
  const visit = await twoPerformerVisit(f);
  const kept = tip(f, 0, 'CASH', '1.000');
  const other = tip(f, 1, 'CARD', '2.000');
  await runTips(f, visit.sessionId, tipInput([kept, other]));
  await f.linkEmployee(must(f.employees[0]), f.userId);
  try {
    await removeFirst(f, visit);
    const changed = ids.newId();
    await expect(
      runTips(
        f,
        visit.sessionId,
        tipInput([{ ...kept, amount: '2.000' }, other], { expected_revision: 1, reason: 'change hers' }),
        { key: changed },
      ),
    ).rejects.toThrow('TIP_SELF_FORBIDDEN');
    expect(await tipQuiet(f, visit.sessionId, changed)).toEqual({
      revisions: 1,
      entries: 2,
      audits: 1,
      events: 1,
      keys: 0,
    });
    const removed = ids.newId();
    await expect(
      runTips(f, visit.sessionId, tipInput([other], { expected_revision: 1, reason: 'remove hers' }), { key: removed }),
    ).rejects.toThrow('TIP_SELF_FORBIDDEN');
    expect(await tipQuiet(f, visit.sessionId, removed)).toEqual({
      revisions: 1,
      entries: 2,
      audits: 1,
      events: 1,
      keys: 0,
    });
  } finally {
    await f.linkEmployee(must(f.employees[0]), null);
  }
});

it('TP-05 a new tip for a removed performer with no other active line is refused', async () => {
  const visit = await twoPerformerVisit(f);
  await removeFirst(f, visit);
  const key = ids.newId();
  await expect(runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CASH', '1.000')]), { key })).rejects.toThrow(
    'TIP_EMPLOYEE_NOT_PERFORMER',
  );
  expect(await tipQuiet(f, visit.sessionId, key)).toEqual({
    revisions: 0,
    entries: 0,
    audits: 0,
    events: 0,
    keys: 0,
  });
});

it('another manager removes the entry of the removed performer', async () => {
  const visit = await twoPerformerVisit(f);
  const kept = tip(f, 0, 'CASH', '1.000');
  const other = tip(f, 1, 'CARD', '2.000');
  await runTips(f, visit.sessionId, tipInput([kept, other]));
  await removeFirst(f, visit);
  const saved = await runTips(
    f,
    visit.sessionId,
    tipInput([other], { expected_revision: 1, reason: 'drop the removed performer' }),
    { userId: f.ownerId },
  );
  expect(saved.revision).toBe(2);
  expect(saved.tips.map((entry) => entry.employee_id)).toEqual([must(f.employees[1])]);
});

it('TP-05 a performer removed from one line still counts while she performs another active line', async () => {
  const visit = await twoLinesOfOnePerformer(f);
  await removeFirst(f, visit);
  const saved = await runTips(f, visit.sessionId, tipInput([tip(f, 0, 'CARD', '1.500')]), { userId: f.ownerId });
  expect(saved.revision).toBe(1);
  const rows = await tipRows(f, visit.sessionId);
  const first = String(must(rows.revisions[0])['id']);
  const entries = rows.entries.filter((entry) => entry['revision_id'] === first);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ employee_id: must(f.employees[0]), method: 'CARD', amount: '1.500' });
});

async function twoPerformerVisit(fixture: TipFixture) {
  const first = fixture.line(must(fixture.services[0]), '25.000', '0.000');
  const second = fixture.line(must(fixture.services[1]), '7.125', '0.000');
  const visit = await recordVisit(fixture, [
    { ...first, performers: [{ employee_id: must(fixture.employees[0]) }] },
    { ...second, performers: [{ employee_id: must(fixture.employees[1]) }] },
  ]);
  return { sessionId: visit.sessionId, lineId: must(visit.lineIds[0]) };
}

async function twoLinesOfOnePerformer(fixture: TipFixture) {
  const first = fixture.line(must(fixture.services[0]), '25.000', '0.000');
  const second = fixture.line(must(fixture.services[1]), '7.125', '0.000');
  const visit = await recordVisit(fixture, [
    { ...first, performers: [{ employee_id: must(fixture.employees[0]) }] },
    { ...second, performers: [{ employee_id: must(fixture.employees[0]) }] },
  ]);
  return { sessionId: visit.sessionId, lineId: must(visit.lineIds[0]) };
}

async function removeFirst(fixture: TipFixture, visit: { sessionId: string; lineId: string }) {
  const next = await employeePerson(changeHost(fixture), must(fixture.employees[1]));
  await replacePerformers(changeHost(fixture), visit.sessionId, visit.lineId, 1, [next]);
}

function changeHost(fixture: TipFixture): PerformerChangeHost {
  return {
    db: fixture.db,
    h: fixture.h,
    company: fixture.company,
    business: fixture.business,
    branch: fixture.branch,
    changerUserId: fixture.userId,
    changerMembershipId: fixture.membership,
  };
}
