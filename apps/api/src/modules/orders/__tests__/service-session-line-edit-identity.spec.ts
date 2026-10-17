import { afterAll, beforeAll, expect, it } from 'vitest';
import { ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';
import { branchManager, editBody, quietCounts, recorded, runEdit } from './line-edit.helpers.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });

it('LE-09/10 a performer-linked editor, including an unlimited owner, is refused and nothing is written', async () => {
  const performer = must(f.employees[0]);
  try {
    await f.h.owner`UPDATE employees SET deleted_at=now() WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
    await f.linkEmployee(performer, f.editorId);
    const managed = await recorded(f);
    const managerKey = ids.newId();
    await expect(runEdit(f, managed.sessionId, managed.lineId, editBody(), { key: managerKey })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    expect(await quietCounts(f, managed.sessionId, managed.lineId, managerKey)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
    await f.linkEmployee(performer, f.ownerId);
    const owned = await recorded(f);
    const ownerKey = ids.newId();
    await expect(runEdit(f, owned.sessionId, owned.lineId, editBody({ price: '27.000', discount: { kind: 'AMOUNT', amount: '0.000' } }), { userId: f.ownerId, key: ownerKey })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    expect(await quietCounts(f, owned.sessionId, owned.lineId, ownerKey)).toEqual({ edits: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.linkEmployee(performer, null);
    await f.h.owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company} AND id=${f.editorEmployee}`;
  }
});

it('LE-11/12/13 a snapshotted user, the relinked user, and any of several performers are refused', async () => {
  const first = await branchManager(f, 'session-editor-u1@example.test');
  const second = await branchManager(f, 'session-editor-u2@example.test');
  const performer = must(f.employees[0]);
  const other = must(f.employees[1]);
  try {
    await f.linkEmployee(performer, first.userId);
    const relinked = await recorded(f);
    await f.linkEmployee(performer, second.userId);
    await expect(runEdit(f, relinked.sessionId, relinked.lineId, editBody(), { userId: first.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    await expect(runEdit(f, relinked.sessionId, relinked.lineId, editBody(), { userId: second.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    const saved = await runEdit(f, relinked.sessionId, relinked.lineId, editBody());
    expect(saved).toMatchObject({ line: { revision: 2, recorded_by: f.userId } });
    await f.linkEmployee(performer, null);
    const later = await recorded(f);
    await f.linkEmployee(performer, second.userId);
    await expect(runEdit(f, later.sessionId, later.lineId, editBody(), { userId: second.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    await f.linkEmployee(performer, first.userId);
    const several = await recorded(f, '25.000', '0.000', [{ employee_id: performer }, { employee_id: other }]);
    await f.linkEmployee(other, second.userId);
    await expect(runEdit(f, several.sessionId, several.lineId, editBody({ price: '26.000', discount: { kind: 'AMOUNT', amount: '0.000' } }), { userId: first.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    await expect(runEdit(f, several.sessionId, several.lineId, editBody({ price: '26.000', discount: { kind: 'AMOUNT', amount: '0.000' } }), { userId: second.userId })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
  } finally {
    await f.linkEmployee(performer, null);
    await f.linkEmployee(other, null);
    await f.h.owner`DELETE FROM memberships WHERE company_id=${f.company} AND id IN (${first.membershipId}, ${second.membershipId})`;
  }
});

it('LE-13b a performer without a stored identity snapshot cannot be edited', async () => {
  const visit = await recorded(f);
  await f.snapshotPerformers(visit.lineId, [{ employee_id: must(f.employees[0]), linked_user_id: null, linked_user_snapshotted: false }]);
  await expect(runEdit(f, visit.sessionId, visit.lineId, editBody())).rejects.toThrow('SESSION_EDIT_IDENTITY_UNKNOWN');
});
