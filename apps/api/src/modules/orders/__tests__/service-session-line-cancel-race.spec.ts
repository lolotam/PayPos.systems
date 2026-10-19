import { IdempotencyKeyBusyError } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { requestFingerprint } from '../../../shared/idempotency.ts';
import { holdVisit, separateOwner, waitForAdvisory } from '../../../../test/session-tips.fixture.ts';
import { ordersLineCancels } from '../orders.module.ts';
import { CancelServiceLineUseCase } from '../use-cases/cancel-service-line/cancel-service-line.usecase.ts';
import { ids, must } from './session.fixture.ts';
import { editBody, runEdit } from './line-edit.helpers.ts';
import { cancelFixture, cancelInput, cancelQuiet, cancelRows, runCancel, type CancelFixture } from './line-cancel.helpers.ts';

let f: CancelFixture;
beforeAll(async () => { f = await cancelFixture(); });
afterAll(async () => { await f?.close(); });
const amount = (value: string) => ({ kind: 'AMOUNT' as const, amount: value });

it('LC-19 the same key, body and actor replay, and a different actor reuses the key', async () => {
  const visit = await visitOfLine(f);
  const key = ids.newId();
  const input = cancelInput();
  const fingerprint = cancelFingerprint(f, visit, f.editorId, input);
  const first = await runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  expect(await runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint })).toEqual(first);
  expect((await cancelRows(f, visit.sessionId, visit.lineId)).cancellations).toHaveLength(1);
  const ownerPrint = cancelFingerprint(f, visit, f.ownerId, input);
  expect(ownerPrint).not.toBe(fingerprint);
  await expect(runCancel(f, visit.sessionId, visit.lineId, input, { userId: f.ownerId, key, fingerprint: ownerPrint })).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
});

it('LC-19 concurrent duplicates of one key fulfill equally and write one row', async () => {
  const visit = await visitOfLine(f);
  const key = ids.newId();
  const fingerprint = 'c'.repeat(64);
  const input = cancelInput();
  const held = await holdVisit(f, visit.sessionId);
  const pending = Promise.allSettled([
    runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint }),
    runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint }),
  ]);
  try { expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1); }
  finally { await held.release(); }
  const [first, second] = await pending;
  expect(first?.status).toBe('fulfilled');
  expect(second?.status).toBe('fulfilled');
  if (first?.status === 'fulfilled' && second?.status === 'fulfilled') expect(second.value).toEqual(first.value);
  expect((await cancelRows(f, visit.sessionId, visit.lineId)).cancellations).toHaveLength(1);
});

it('LC-19 a claim that outwaits the lock returns IdempotencyKeyBusyError', async () => {
  const visit = await visitOfLine(f);
  const key = ids.newId();
  const fingerprint = 'd'.repeat(64);
  const held = await holdVisit(f, visit.sessionId);
  const first = runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key, fingerprint });
  try {
    expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1);
    await expect(runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key, fingerprint })).rejects.toBeInstanceOf(IdempotencyKeyBusyError);
    await held.release();
    await expect(first).resolves.toMatchObject({ line: { status: 'CANCELLED' } });
  } finally { await held.release(); }
}, 20_000);

it('a replay stays allowed when a second membership appears and the request omitted the choice', async () => {
  const visit = await visitOfLine(f);
  const key = ids.newId();
  const fingerprint = '9'.repeat(64);
  const input = cancelInput();
  const first = await runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  const extra = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    SELECT ${f.company},${extra},${f.editorId},role_id,role_owner_key,'COMPANY',${f.company},2000,'2026-01-01T00:00:00Z'
    FROM memberships WHERE company_id=${f.company} AND id=${f.editorMembership}`;
  try {
    expect(await runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint })).toEqual(first);
    expect((await cancelRows(f, visit.sessionId, visit.lineId)).cancellations).toHaveLength(1);
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at='2026-10-14T00:00:00Z' WHERE company_id=${f.company} AND id=${extra}`;
  }
});

it('LC-20 two managers racing revision 1 leave one row, and a retry stays stale', async () => {
  const visit = await visitOfLine(f);
  const editorKey = ids.newId();
  const ownerKey = ids.newId();
  const held = await holdVisit(f, visit.sessionId);
  const pending = Promise.allSettled([
    runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key: editorKey, fingerprint: 'c'.repeat(64) }),
    runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { userId: f.ownerId, key: ownerKey, fingerprint: 'd'.repeat(64) }),
  ]);
  try { expect(await waitForAdvisory(f, held.pid, 2)).toBeGreaterThanOrEqual(2); }
  finally { await held.release(); }
  const [editor, owner] = await pending;
  const outcomes = [editor, owner];
  expect(outcomes.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
  const loser = outcomes.find((item) => item.status === 'rejected');
  expect(loser?.status).toBe('rejected');
  if (loser?.status !== 'rejected') return;
  expect(loser.reason).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 2 } });
  expect(Object.keys((loser.reason as { details: object }).details)).toEqual(['current_revision']);
  const loserKey = editor?.status === 'rejected' ? editorKey : ownerKey;
  expect(await cancelQuiet(f, visit.sessionId, visit.lineId, loserKey)).toMatchObject({ keys: 0 });
  expect((await cancelRows(f, visit.sessionId, visit.lineId)).cancellations).toHaveLength(1);
  const retryUser = editor?.status === 'rejected' ? f.editorId : f.ownerId;
  const again = await runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { userId: retryUser, key: ids.newId(), fingerprint: 'e'.repeat(64) }).then(() => null, (error: unknown) => error);
  expect(again).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 2 } });
});

it('LC-21 a second cancel at the current revision is already cancelled', async () => {
  const visit = await visitOfLine(f);
  await runCancel(f, visit.sessionId, visit.lineId);
  const key = ids.newId();
  await expect(runCancel(f, visit.sessionId, visit.lineId, cancelInput({ expected_revision: 2 }), { key })).rejects.toThrow('SESSION_LINE_ALREADY_CANCELLED');
  expect((await cancelRows(f, visit.sessionId, visit.lineId)).cancellations).toHaveLength(1);
  expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toMatchObject({ keys: 0 });
});

it('LC-22 a replay whose permission is then denied is forbidden and keeps the stored body', async () => {
  const visit = await visitOfLine(f);
  const key = ids.newId();
  const fingerprint = 'e'.repeat(64);
  const input = cancelInput();
  await runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  const replay = denyingCancel(f);
  await expect(replay.execute({ ...f.context(key, f.editorId, fingerprint), sessionId: visit.sessionId, lineId: visit.lineId, input })).rejects.toThrow('FORBIDDEN');
  const [again] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  expect(again?.['body']).toBe(stored?.['body']);
  expect((await cancelRows(f, visit.sessionId, visit.lineId)).cancellations).toHaveLength(1);
});

it('LC-22 an ended membership writes nothing, and a later deny blocks the replay', async () => {
  const fresh = await visitOfLine(f);
  const freshKey = ids.newId();
  await f.h.owner`UPDATE memberships SET ends_at='2026-10-14T00:00:00Z' WHERE company_id=${f.company} AND id=${f.editorMembership}`;
  try {
    await expect(runCancel(f, fresh.sessionId, fresh.lineId, cancelInput(), { key: freshKey })).rejects.toThrow('FORBIDDEN');
    expect(await cancelQuiet(f, fresh.sessionId, fresh.lineId, freshKey)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND id=${f.editorMembership}`;
  }
  const visit = await visitOfLine(f);
  const key = ids.newId();
  const fingerprint = '1'.repeat(64);
  const input = cancelInput();
  const full = await runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  const [stored] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.editorMembership},'cancel:service-lines:branch','DENY','BRANCH',${f.branch},'Synthetic cancel deny',${f.ownerId})`;
  try {
    await expect(runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint })).rejects.toThrow('FORBIDDEN');
    const [again] = await f.h.owner`SELECT response_body::text AS body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
    expect(again?.['body']).toBe(stored?.['body']);
    expect(full).toMatchObject({ line: { status: 'CANCELLED' } });
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  }
});

it('LC-22 a new cancel waiting on the visit lock is forbidden when a DENY lands before release, and nothing is written', async () => {
  const visit = await visitOfLine(f);
  const held = await holdVisit(f, visit.sessionId);
  const key = ids.newId();
  const pending = runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key });
  const deny = ids.newId();
  const owner = separateOwner(f);
  try {
    expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1);
    await owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
      VALUES(${f.company},${deny},${f.editorMembership},'cancel:service-lines:branch','DENY','BRANCH',${f.branch},'Synthetic waiting deny',${f.ownerId})`;
    await held.release();
    await expect(pending).rejects.toThrow('FORBIDDEN');
    expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await held.release();
    await pending.catch(() => undefined);
    await owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
    await owner.end();
  }
}, 20_000);

it('a read deny on replay narrows the stored full body', async () => {
  const visit = await visitOfLine(f);
  const key = ids.newId();
  const fingerprint = '2'.repeat(64);
  const input = cancelInput();
  const full = await runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint });
  expect(full).toMatchObject({ line: { status: 'CANCELLED' } });
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.editorMembership},'read:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic read deny',${f.ownerId})`;
  try {
    expect(await runCancel(f, visit.sessionId, visit.lineId, input, { key, fingerprint })).toEqual({ cancelled: true });
  } finally {
    await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`;
  }
});

it('LC-23 an edit of a cancelled line is not editable, and a cancel of an edited line is stale', async () => {
  const cancelled = await visitOfLine(f);
  await runCancel(f, cancelled.sessionId, cancelled.lineId);
  await expect(runEdit(f, cancelled.sessionId, cancelled.lineId, editBody({ price: '20.000', discount: amount('0.000'), expected_revision: 2 }))).rejects.toThrow('SESSION_LINE_NOT_EDITABLE');
  const edited = await visitOfLine(f);
  await runEdit(f, edited.sessionId, edited.lineId, editBody({ price: '20.000', discount: amount('0.000') }));
  const stale = await runCancel(f, edited.sessionId, edited.lineId).then(() => null, (error: unknown) => error);
  expect(stale).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE', details: { current_revision: 2 } });
  expect(Object.keys((stale as { details: object }).details)).toEqual(['current_revision']);
});

function cancelFingerprint(
  fixture: CancelFixture,
  visit: { sessionId: string; lineId: string },
  userId: string,
  body: ReturnType<typeof cancelInput>,
) {
  return requestFingerprint({
    method: 'POST',
    route: '/v1/businesses/:businessId/branches/:branchId/service-sessions/:sessionId/lines/:lineId/cancel',
    query: {},
    body,
    params: {
      businessId: fixture.business,
      branchId: fixture.branch,
      companyId: fixture.company,
      actorUserId: userId,
      sessionId: visit.sessionId,
      lineId: visit.lineId,
    },
  });
}

async function visitOfLine(f: CancelFixture) {
  const visit = await f.create.execute({ ...f.context(), input: f.body([f.line(must(f.services[0]), '25.000', '0.000')]) });
  return { sessionId: visit.session.id, lineId: must(visit.session.lines[0]).id };
}

function denyingCancel(f: CancelFixture) {
  const base = ordersLineCancels(f.db);
  return new CancelServiceLineUseCase({
    run: (context, work) => base.run(context, (tx) => work({
      ...tx,
      access: { lock: () => tx.access.lock(), read: async (at) => ({ ...(await tx.access.read(at)), denied: true }) },
    })),
  }, ids, f.clock);
}
