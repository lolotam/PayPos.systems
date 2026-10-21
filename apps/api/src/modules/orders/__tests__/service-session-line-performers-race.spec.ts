import { afterAll, beforeAll, expect, it } from 'vitest';
import { holdVisit, separateOwner, waitForAdvisory } from '../../../../test/session-tips.fixture.ts';
import { requestFingerprint } from '../../../shared/idempotency.ts';
import { ids, must } from './session.fixture.ts';
import { editBody, runEdit } from './line-edit.helpers.ts';
import {
  changeQuiet,
  changeRows,
  performersFixture,
  performersInput,
  runChange,
  scopedMember,
  visitOf,
  type PerformersFixture,
} from './line-performers.helpers.ts';

let f: PerformersFixture;
beforeAll(async () => { f = await performersFixture(); });
afterAll(async () => { await f?.close(); });

it('PC-20 the same key, body and actor replay, and a different actor reuses the key', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  const input = performersInput({ performers: [{ employee_id: must(f.employees[1]) }] });
  const fingerprint = changeFingerprint(f, visit.sessionId, line, f.editorId, input);
  const first = await runChange(f, visit.sessionId, line, input, { key, fingerprint });
  const written = await expectOneChange(f, visit.sessionId, line);
  expect(await runChange(f, visit.sessionId, line, input, { key, fingerprint })).toEqual(first);
  const replayed = await expectOneChange(f, visit.sessionId, line);
  expect(replayed.sides).toEqual(written.sides);
  const ownerPrint = changeFingerprint(f, visit.sessionId, line, f.ownerId, input);
  expect(ownerPrint).not.toBe(fingerprint);
  await expect(runChange(f, visit.sessionId, line, input, { userId: f.ownerId, key, fingerprint: ownerPrint })).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED' });
});

it('PC-20 concurrent duplicates of one key fulfil equally and write one header', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  const fingerprint = 'c'.repeat(64);
  const input = performersInput({ performers: [{ employee_id: must(f.employees[1]) }] });
  const held = await holdVisit(f, visit.sessionId);
  const pending = Promise.allSettled([
    runChange(f, visit.sessionId, line, input, { key, fingerprint }),
    runChange(f, visit.sessionId, line, input, { key, fingerprint }),
  ]);
  try { expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1); }
  finally { await held.release(); }
  const [first, second] = await pending;
  expect(first?.status).toBe('fulfilled');
  expect(second?.status).toBe('fulfilled');
  if (first?.status === 'fulfilled' && second?.status === 'fulfilled') expect(second.value).toEqual(first.value);
  await expectOneChange(f, visit.sessionId, line);
});

it('PC-20 a replay whose read permission is denied narrows the stored full body', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  const fingerprint = '2'.repeat(64);
  const input = performersInput({ performers: [{ employee_id: must(f.employees[1]) }] });
  const full = await runChange(f, visit.sessionId, line, input, { key, fingerprint });
  expect(full).toMatchObject({ line: { revision: 2 } });
  await expectOneChange(f, visit.sessionId, line);
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.editorMembership},'read:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic read deny',${f.ownerId})`;
  try {
    expect(await runChange(f, visit.sessionId, line, input, { key, fingerprint })).toEqual({ changed: true });
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  }
  await expectOneChange(f, visit.sessionId, line);
});

it('PC-21 two managers racing revision 1 leave one header, and a retry stays stale', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const editorKey = ids.newId();
  const ownerKey = ids.newId();
  const input = performersInput({ performers: [{ employee_id: must(f.employees[1]) }] });
  const held = await holdVisit(f, visit.sessionId);
  const pending = Promise.allSettled([
    runChange(f, visit.sessionId, line, input, { key: editorKey, fingerprint: 'c'.repeat(64) }),
    runChange(f, visit.sessionId, line, input, { userId: f.ownerId, key: ownerKey, fingerprint: 'd'.repeat(64) }),
  ]);
  try { expect(await waitForAdvisory(f, held.pid, 2)).toBeGreaterThanOrEqual(2); }
  finally { await held.release(); }
  const [editor, owner] = await pending;
  const outcomes = [editor, owner];
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  const loser = outcomes.find((item) => item.status === 'rejected');
  if (loser?.status !== 'rejected') throw new Error('expected one stale refusal');
  expect(loser.reason).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 2 } });
  expect(Object.keys((loser.reason as { details: object }).details)).toEqual(['current_revision']);
  const loserKey = editor?.status === 'rejected' ? editorKey : ownerKey;
  expect(await changeQuiet(f, visit.sessionId, line, loserKey)).toMatchObject({ keys: 0 });
  expect((await changeRows(f, visit.sessionId, line)).headers).toHaveLength(1);
  const retryUser = editor?.status === 'rejected' ? f.editorId : f.ownerId;
  const again = await runChange(f, visit.sessionId, line, input, { userId: retryUser, key: ids.newId(), fingerprint: 'e'.repeat(64) })
    .then(() => null, (error: unknown) => error);
  expect(again).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 2 } });
});

it('PC-22 a deny that lands while the request waits refuses it and writes nothing', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const held = await holdVisit(f, visit.sessionId);
  const key = ids.newId();
  const pending = runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { key });
  const deny = ids.newId();
  const owner = separateOwner(f);
  try {
    expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1);
    await owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${deny},${f.editorMembership},'change:service-line-performers:branch','DENY','BRANCH',${f.branch},'Synthetic waiting deny',${f.ownerId})`;
    await held.release();
    await expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await changeQuiet(f, visit.sessionId, line, key)).toEqual({ headers: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await held.release();
    await pending.catch(() => undefined);
    await owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
    await owner.end();
  }
});

it('PC-22 a replay after a later deny is forbidden and keeps the stored body', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  const key = ids.newId();
  const fingerprint = '1'.repeat(64);
  const input = performersInput({ performers: [{ employee_id: must(f.employees[1]) }] });
  await runChange(f, visit.sessionId, line, input, { key, fingerprint });
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.editorMembership},'change:service-line-performers:branch','DENY','BRANCH',${f.branch},'Synthetic later deny',${f.ownerId})`;
  try {
    await expect(runChange(f, visit.sessionId, line, input, { key, fingerprint })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  }
});

it('PC-23 a cancelled line is not changeable and a changed line makes the price edit stale', async () => {
  const cancelled = await visitOf(f);
  const cancelledLine = must(cancelled.lines[0]).id;
  await f.cancel.execute({
    ...f.context(ids.newId(), f.editorId),
    sessionId: cancelled.sessionId,
    lineId: cancelledLine,
    input: { reason: 'Synthetic cancel reason', expected_revision: 1 },
  });
  await expect(runChange(f, cancelled.sessionId, cancelledLine, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[1]) }] }))).rejects.toMatchObject({ code: 'SESSION_LINE_NOT_EDITABLE' });
  const changed = await visitOf(f);
  const changedLine = must(changed.lines[0]).id;
  await runChange(f, changed.sessionId, changedLine, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }));
  const stale = await runEdit(f, changed.sessionId, changedLine, editBody({ expected_revision: 1 })).then(() => null, (error: unknown) => error);
  expect(stale).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 2 } });
});

it('PC-23 a tip recorded for a performer who is removed stays recorded', async () => {
  const visit = await visitOf(f);
  const line = must(visit.lines[0]).id;
  await f.tips.execute({
    ...f.context(),
    sessionId: visit.sessionId,
    input: { tips: [{ employee_id: must(f.employees[0]), method: 'CASH', amount: '1.000' }], expected_revision: 0 },
  });
  await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }));
  const entries = await f.h.owner`SELECT employee_id,method,amount::text FROM session_tips
    WHERE company_id=${f.company} AND session_id=${visit.sessionId}`;
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ employee_id: must(f.employees[0]), method: 'CASH', amount: '1.000' });
});

it('PC-24 two changes in a row leave a continuous revision chain and the total never moves', async () => {
  const first = await scopedMember(f, 'performers-first@example.test', 'branch_manager', 'BRANCH', f.branch);
  const second = await scopedMember(f, 'performers-second@example.test', 'branch_manager', 'BRANCH', f.branch);
  await f.linkEmployee(must(f.employees[0]), first.userId);
  await f.linkEmployee(must(f.employees[1]), second.userId);
  try {
    const visit = await visitOf(f);
    const line = must(visit.lines[0]).id;
    const firstChange = await runChange(f, visit.sessionId, line, performersInput({ performers: [{ employee_id: must(f.employees[1]) }] }), { userId: f.ownerId });
    expect(firstChange).toMatchObject({ session: { total_net: '25.000' } });
    const secondChange = await runChange(f, visit.sessionId, line, performersInput({ expected_revision: 2, performers: [{ employee_id: must(f.employees[0]) }] }), { userId: f.ownerId });
    expect(secondChange).toMatchObject({ session: { total_net: '25.000' } });
    const saved = await changeRows(f, visit.sessionId, line);
    expect(saved.line).toMatchObject({ revision: 3, price: '25.000', net: '25.000' });
    expect(saved.headers.map((row) => [Number(row['revision']), Number(row['previous_revision'])])).toEqual([[2, 1], [3, 2]]);
    const firstKey = ids.newId();
    const before = await changeQuiet(f, visit.sessionId, line, firstKey);
    await expect(runChange(f, visit.sessionId, line, performersInput({ expected_revision: 3, performers: [{ employee_id: must(f.employees[2]) }] }), { userId: first.userId, key: firstKey })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    expect(await changeQuiet(f, visit.sessionId, line, firstKey)).toEqual(before);
    const secondKey = ids.newId();
    await expect(runChange(f, visit.sessionId, line, performersInput({ expected_revision: 3, performers: [{ employee_id: must(f.employees[2]) }] }), { userId: second.userId, key: secondKey })).rejects.toThrow('SESSION_PERFORMER_SELF_FORBIDDEN');
    expect(await changeQuiet(f, visit.sessionId, line, secondKey)).toEqual({ ...before, keys: 0 });
  } finally {
    await f.linkEmployee(must(f.employees[0]), null);
    await f.linkEmployee(must(f.employees[1]), null);
  }
});

function changeFingerprint(
  fixture: PerformersFixture,
  sessionId: string,
  lineId: string,
  userId: string,
  body: unknown,
) {
  return requestFingerprint({
    method: 'PUT',
    route: '/v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/lines/:lineId/performers',
    query: {},
    body,
    params: {
      businessId: fixture.business,
      branchId: fixture.branch,
      companyId: fixture.company,
      actorUserId: userId,
      sessionId,
      lineId,
    },
  });
}

/** يثبت أن التغيير كُتب مرة واحدة: رأس واحد وأثر واحد وحدث واحد ونسخة واحدة وصفوف sides ثابتة. */
async function expectOneChange(fixture: PerformersFixture, sessionId: string, lineId: string) {
  const saved = await changeRows(fixture, sessionId, lineId);
  expect(saved.headers).toHaveLength(1);
  expect(saved.audits).toHaveLength(1);
  expect(saved.events).toHaveLength(1);
  expect(saved.sides).toHaveLength(2);
  expect(saved.line).toMatchObject({ revision: 2 });
  return saved;
}
