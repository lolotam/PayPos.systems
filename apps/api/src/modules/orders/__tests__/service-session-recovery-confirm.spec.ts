import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { recoveryKeyHash } from '../persistence/session-recovery.adapter.ts';
import { AT, ids, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture({ ordersClock: { now: () => f?.clock.now() ?? AT } }); });
afterEach(() => { f?.setAt(AT); });
afterAll(async () => { await f?.close(); });

async function confirm(key: string, outcome: 'RECORDED_ELSEWHERE' | 'NOT_RECORDED' = 'NOT_RECORDED', cookie = f.cookie) {
  const res = await f.h.app.inject({ method: 'POST', url: `${f.base}/recovery/confirm`,
    headers: { cookie, 'x-company-id': f.company, 'x-recovery-key': key },
    payload: { operation: 'record-service-session', outcome } });
  return { status: res.statusCode, body: res.body === '' ? {} : res.json() as Record<string, unknown>, text: res.body };
}
async function proof(key: string) {
  const [row] = await f.h.owner`SELECT revoked_outcome, revoked_at IS NOT NULL AS revoked FROM service_session_recoveries
    WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`;
  return row;
}
async function audits() {
  return f.h.owner`SELECT action, before::text AS before, after::text AS after FROM audit_log
    WHERE company_id=${f.company} AND entity='service_session_recovery'`;
}

it('keeps the first outcome, writes one audit row, and answers 204 again', async () => {
  const key = ids.newId();
  await f.create.execute({ ...f.context(key), input: f.body() });
  const before = await audits();
  expect((await confirm(key, 'NOT_RECORDED')).status).toBe(204);
  expect((await confirm(key, 'RECORDED_ELSEWHERE')).status).toBe(204);
  expect(await proof(key)).toMatchObject({ revoked_outcome: 'NOT_RECORDED', revoked: true });
  const rows = await audits();
  expect(rows).toHaveLength(before.length + 1);
  const entry = must(rows.at(-1));
  expect(entry['action']).toBe('recovery.confirmed');
  expect(String(entry['before'])).toContain('null');
  expect(String(entry['after'])).toContain('NOT_RECORDED');
  expect(`${entry['before']}${entry['after']}`).not.toContain(key);
});

it('answers 204 for an unknown key and still revokes an expired proof', async () => {
  const before = (await audits()).length;
  const unknown = await confirm(ids.newId(), 'RECORDED_ELSEWHERE');
  expect(unknown.status).toBe(204);
  expect(unknown.text).toBe('');
  expect(await audits()).toHaveLength(before);
  const key = ids.newId();
  await f.create.execute({ ...f.context(key), input: f.body() });
  await f.h.owner`UPDATE service_session_recoveries SET expires_at = issued_at + interval '1 second' WHERE company_id=${f.company} AND key_hash=${recoveryKeyHash(key)}`;
  f.setAt(new Date(AT.getTime() + 1000));
  expect((await confirm(key, 'RECORDED_ELSEWHERE')).status).toBe(204);
  expect(await proof(key)).toMatchObject({ revoked_outcome: 'RECORDED_ELSEWHERE', revoked: true });
  expect(await audits()).toHaveLength(before + 1);
});

it('refuses confirm without record access and leaves the proof open', async () => {
  const key = ids.newId();
  await f.create.execute({ ...f.context(key), input: f.body() });
  const deny = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${deny},${f.membership},'record:service-sessions:branch','DENY','BRANCH',${f.branch},'Synthetic confirm denial',${f.ownerId})`;
  try {
    expect((await confirm(key)).status).toBe(403);
    expect((await proof(key))?.['revoked']).toBe(false);
  } finally { await f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${deny}`; }
  expect((await f.h.app.inject({ method: 'POST', url: `${f.base}/recovery/confirm`, headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: { operation: 'record-service-session', outcome: 'NOT_RECORDED' } })).statusCode).toBe(400);
});
