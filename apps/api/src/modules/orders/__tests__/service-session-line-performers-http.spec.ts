import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  changeLinePerformersResponseFull,
  changeLinePerformersResponseNarrow,
  recordServiceSessionResponse,
} from '@pospay/contracts';
import { serviceSessionErrors } from '@pospay/i18n';
import { SYSTEM_ROLES } from '@pospay/db';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { AT, ids, must, editFixture, type EditFixture } from './session.fixture.ts';

let f: EditFixture;
let narrowCookie = '';
let secondManagerCookie = '';
beforeAll(async () => {
  f = await editFixture({ ordersClock: { now: () => f?.clock.now() ?? AT } });
  narrowCookie = await performersOnlyCookie();
  secondManagerCookie = await branchManagerCookie();
});
afterAll(async () => {
  await f?.close();
});

const PHONE = '+999999998123';
const CUSTOMER = 'Synthetic customer';
const CHANGER_NAME = 'Layla Editor';
const HIDDEN = ['reason', 'changed_by', 'changed_by_membership_id', 'changer_name', 'changer_role', 'phone'];
const input = (expected = 1, reason: string | null = 'Synthetic performers reason', employee = 1) => ({
  performers: [{ employee_id: must(f.employees[employee]), share_bps: 10000 }],
  ...(reason === null ? {} : { reason }),
  expected_revision: expected,
});
const url = (sessionId: string, lineId: string, branch = f.branch, business = f.business) =>
  `/v1/businesses/${business}/branches/${branch}/service-sessions/${sessionId}/lines/${lineId}/performers`;
const put = async (target: string, body: object, cookie = f.editorCookie, key: string | null = ids.newId(), company = f.company) => {
  const res = await f.h.app.inject({
    method: 'PUT', url: target, payload: body,
    headers: { cookie, 'x-company-id': company, ...(key === null ? {} : { 'idempotency-key': key }) },
  });
  return { status: res.statusCode, body: (res.body === '' ? {} : res.json()) as Record<string, unknown>, text: res.body };
};

it('a reader gets the changed line with the new performers and the mark, and the replay writes once', async () => {
  const reason = `sentinel-${ids.newId()}`;
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  const key = ids.newId();
  const first = await put(target, input(1, reason), f.editorCookie, key);
  const replay = await put(target, input(1, reason), f.editorCookie, key);
  expect(first.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  const parsed = changeLinePerformersResponseFull.parse(first.body);
  expect(parsed.line).toMatchObject({ id: visit.lineId, status: 'ACTIVE', revision: 2, performers_changed_at: '2026-10-15' });
  expect(parsed.line.performers.map((row) => [row.employee_id, row.performer_ordinal, row.share_bps]))
    .toEqual([[must(f.employees[1]), 1, 10000]]);
  expect(Object.keys(parsed.session).sort()).toEqual(['id', 'total_net']);
  expect(parsed.session.total_net).toBe('25.000');
  const packed = JSON.stringify(first.body);
  expect(packed).not.toContain(reason);
  expect(packed).not.toContain(PHONE);
  expect(packed).not.toContain(CUSTOMER);
  expect(packed).not.toContain(CHANGER_NAME);
  expect(packed).not.toContain(f.editorId);
  expect(packed).not.toContain(f.editorMembership);
  for (const field of HIDDEN) expect(nestedHas(first.body, field)).toBe(false);
  expect(await changesOf(visit.lineId)).toBe(1);
});

it('a caller with the change permission and without the branch read gets only the change mark', async () => {
  const visit = await savedVisit();
  const reason = `sentinel-${ids.newId()}`;
  const key = ids.newId();
  const target = url(visit.sessionId, visit.lineId);
  const first = await put(target, input(1, reason), narrowCookie, key);
  const replay = await put(target, input(1, reason), narrowCookie, key);
  expect(first.status).toBe(200);
  expect(changeLinePerformersResponseNarrow.parse(first.body)).toEqual({ changed: true });
  expect(replay.body).toEqual(first.body);
  expect(Object.keys(first.body as object).sort()).toEqual(['changed']);
  expect(JSON.stringify(first.body)).not.toContain(reason);
  expect(await changesOf(visit.lineId)).toBe(1);
});

it('PC-07 the route refuses a caller without the permission, a device and a disabled feature, and writes nothing', async () => {
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  const denied = await put(target, input(), f.cookie);
  expect(denied.status).toBe(403);
  expect(denied.body['code']).toBe('FORBIDDEN');
  const device = await paired(f.h, f.ownerCookie, f.company, f.branch);
  const deviceReply = await f.h.app.inject({
    method: 'PUT', url: target, payload: input(),
    headers: { authorization: `Device ${device.token}`, origin, 'x-company-id': f.company, 'idempotency-key': ids.newId() },
  });
  expect(deviceReply.statusCode).toBe(403);
  expect(deviceReply.json().code).toBe('FORBIDDEN');
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic performers feature',${f.ownerId})`;
  try {
    const disabled = await put(target, input());
    expect(disabled.status).toBe(403);
    expect(disabled.body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
  expect(await changesOf(visit.lineId)).toBe(0);
  expect(await eventsOf(visit.sessionId)).toBe(0);
});

it('PC-07 a foreign line, visit, branch, business or company is the same 403 and writes nothing', async () => {
  const visit = await savedVisit();
  const other = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  const unknownLineKey = ids.newId();
  const otherVisitKey = ids.newId();
  const unknownVisitKey = ids.newId();
  const otherBranchKey = ids.newId();
  const otherBusinessKey = ids.newId();
  const otherCompanyKey = ids.newId();
  const foreign = [
    await put(url(visit.sessionId, ids.newId()), input(), f.editorCookie, unknownLineKey),
    await put(url(visit.sessionId, other.lineId), input(), f.editorCookie, otherVisitKey),
    await put(url(ids.newId(), visit.lineId), input(), f.editorCookie, unknownVisitKey),
    await put(url(visit.sessionId, visit.lineId, f.secondBranch), input(), f.ownerCookie, otherBranchKey),
    await put(url(visit.sessionId, visit.lineId, f.foreignBranch, f.foreignBusiness), input(), f.ownerCookie, otherBusinessKey),
    await put(target, input(), f.ownerCookie, otherCompanyKey, f.otherCompany),
  ];
  const body = JSON.stringify(foreign[0]?.body);
  expect(foreign.every((reply) => reply.status === 403 && JSON.stringify(reply.body) === body)).toBe(true);
  expect(foreign[0]?.body['code']).toBe('FORBIDDEN');
  for (const key of [unknownLineKey, otherVisitKey, unknownVisitKey, otherBranchKey, otherBusinessKey, otherCompanyKey]) {
    expect(await keyRows(key)).toBe(0);
  }
  expect(await changesOf(visit.lineId)).toBe(0);
  expect(await auditsOf(visit.lineId)).toBe(0);
  expect(await eventsOf(visit.sessionId)).toBe(0);
});

it('PC-16 a missing, blank or long reason is 422 and the trimmed reason is kept in the history', async () => {
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  for (const reason of [null, '', ' \t\r\n ', 'ا'.repeat(501)]) {
    const refused = await put(target, input(1, reason));
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'SESSION_PERFORMERS_REASON_INVALID',
      ...serviceSessionErrors.SESSION_PERFORMERS_REASON_INVALID,
    });
  }
  expect(await changesOf(visit.lineId)).toBe(0);
  const trimmed = await put(target, input(1, ' \tkept\r\n '));
  expect(trimmed.status).toBe(200);
  const stored = await f.h.owner`SELECT reason FROM service_line_performer_changes
    WHERE company_id=${f.company} AND line_id=${visit.lineId}`;
  expect(stored).toEqual([{ reason: 'kept' }]);
  const long = await savedVisit();
  const reason = 'ا'.repeat(500);
  expect((await put(url(long.sessionId, long.lineId), input(1, reason))).status).toBe(200);
  const longStored = await f.h.owner`SELECT reason FROM service_line_performer_changes
    WHERE company_id=${f.company} AND line_id=${long.lineId}`;
  expect(longStored[0]?.['reason']).toBe(reason);
});

it('PC-20 the route refuses a missing key, replays the same key and body, and refuses the same key with another body', async () => {
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  const missing = await put(target, input(), f.editorCookie, null);
  expect(missing.status).toBe(400);
  expect(missing.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
  expect(await changesOf(visit.lineId)).toBe(0);
  const key = ids.newId();
  const first = await put(target, input(), f.editorCookie, key);
  expect(first.status).toBe(200);
  const replay = await put(target, input(), f.editorCookie, key);
  expect(replay.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  const other = await put(target, input(1, 'Another synthetic reason'), f.editorCookie, key);
  expect(other.status).toBe(422);
  expect(other.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  expect(await changesOf(visit.lineId)).toBe(1);
  expect(await eventsOf(visit.sessionId)).toBe(1);
});

it('PC-20 the idempotency fingerprint binds the line and the actor, so one key on another line or another changer is reused', async () => {
  const visit = await savedVisitLines([f.line(), f.line()]);
  const first = must(visit.lineIds[0]);
  const second = must(visit.lineIds[1]);
  const key = ids.newId();
  expect((await put(url(visit.sessionId, first), input(), f.editorCookie, key)).status).toBe(200);
  const otherLine = await put(url(visit.sessionId, second), input(), f.editorCookie, key);
  expect(otherLine.status).toBe(422);
  expect(otherLine.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  expect(await changesOf(second)).toBe(0);
  const otherBody = await put(url(visit.sessionId, first), input(1, 'Another synthetic reason'), f.editorCookie, key);
  expect(otherBody.status).toBe(422);
  expect(otherBody.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  const otherActor = await put(url(visit.sessionId, first), input(), secondManagerCookie, key);
  expect(otherActor.status).toBe(422);
  expect(otherActor.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  expect(await changesOf(first)).toBe(1);
  expect(await eventsOf(visit.sessionId)).toBe(1);
});

it('the mark on the write path is the business-timezone day, not the UTC day', async () => {
  const visit = await savedVisit();
  f.setAt(new Date('2026-10-15T22:30:00.000Z'));
  try {
    const reply = await put(url(visit.sessionId, visit.lineId), input());
    expect(reply.status).toBe(200);
    expect(changeLinePerformersResponseFull.parse(reply.body).line.performers_changed_at).toBe('2026-10-16');
  } finally {
    f.setAt(AT);
  }
});

it('a stale expected_revision is 409 with current_revision only', async () => {
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  const stale = await put(target, input(9), f.editorCookie, ids.newId());
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({
    code: 'SESSION_LINE_REVISION_STALE',
    ...serviceSessionErrors.SESSION_LINE_REVISION_STALE,
    details: { current_revision: 1 },
  });
  expect(Object.keys(stale.body['details'] as object)).toEqual(['current_revision']);
  expect(JSON.stringify(stale.body['details'])).not.toMatch(/\d\.\d{3}/);
  expect(await changesOf(visit.lineId)).toBe(0);
});

it('PC-08 the caller who performed the line is refused', async () => {
  const visit = await savedVisit([{ ...f.line(), performers: [{ employee_id: f.editorEmployee }] }]);
  const refused = await put(url(visit.sessionId, visit.lineId), input());
  expect(refused.status).toBe(403);
  expect(refused.body).toMatchObject({
    code: 'SESSION_PERFORMER_SELF_FORBIDDEN',
    ...serviceSessionErrors.SESSION_PERFORMER_SELF_FORBIDDEN,
  });
  expect(await changesOf(visit.lineId)).toBe(0);
});

it('a bad shape stays 400', async () => {
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  expect((await put(target, { ...input(), extra: 'x' })).body['code']).toBe('VALIDATION_FAILED');
  expect((await put(target, { ...input(), expected_revision: 0 })).status).toBe(400);
  expect((await put(target, { ...input(), performers: [{ employee_id: 'not-an-id' }] })).status).toBe(400);
});

async function savedVisit(lines?: Parameters<EditFixture['body']>[0]) {
  const response = await f.h.send('POST', f.base, {
    cookie: f.ownerCookie, company: f.company, key: ids.newId(), body: f.body(lines ?? [f.line()]),
  });
  expect(response.status).toBe(201);
  const session = recordServiceSessionResponse.parse(response.body).session;
  return { sessionId: session.id, lineId: must(session.lines[0]).id };
}

async function savedVisitLines(lines: Parameters<EditFixture['body']>[0]) {
  const response = await f.h.send('POST', f.base, {
    cookie: f.ownerCookie, company: f.company, key: ids.newId(), body: f.body(lines),
  });
  expect(response.status).toBe(201);
  const session = recordServiceSessionResponse.parse(response.body).session;
  return { sessionId: session.id, lineIds: session.lines.map((line) => line.id) };
}

async function changesOf(lineId: string) {
  const rows = await f.h.owner`SELECT count(*)::int AS n FROM service_line_performer_changes
    WHERE company_id=${f.company} AND line_id=${lineId}`;
  return Number(rows[0]?.['n']);
}

async function auditsOf(lineId: string) {
  const rows = await f.h.owner`SELECT count(*)::int AS n FROM audit_log
    WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.performers_changed'`;
  return Number(rows[0]?.['n']);
}

async function keyRows(key: string) {
  const rows = await f.h.owner`SELECT count(*)::int AS n FROM idempotency_keys WHERE key=${key}`;
  return Number(rows[0]?.['n']);
}

async function eventsOf(sessionId: string) {
  const rows = await f.h.owner`SELECT count(*)::int AS n FROM outbox
    WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'`;
  return Number(rows[0]?.['n']);
}

async function performersOnlyCookie() {
  const cookie = await f.h.signedInOperator('session-performers-only@example.test');
  const users = await f.h.owner`SELECT id FROM "user" WHERE email='session-performers-only@example.test'`;
  const userId = must(users[0])['id'] as string;
  const role = ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES(${role},${f.company},'synthetic_performers_changer','Synthetic performer changer')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES(${role},${f.company},${f.company},'change:service-line-performers:branch')`;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${ids.newId()},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  return cookie;
}

// مدير ثانٍ بنفس الإذن: البصمة تربط المفتاح بالفاعل، فمفتاح المدير الأول لا يُقبل منه.
async function branchManagerCookie() {
  const cookie = await f.h.signedInOperator('session-performers-manager@example.test');
  const users = await f.h.owner`SELECT id FROM "user" WHERE email='session-performers-manager@example.test'`;
  const userId = must(users[0])['id'] as string;
  const role = must(SYSTEM_ROLES.find((item) => item.code === 'branch_manager')).id;
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${ids.newId()},${userId},${role},'global','BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  return cookie;
}

function nestedHas(value: unknown, key: string): boolean {
  if (Array.isArray(value)) return value.some((item) => nestedHas(item, key));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return key in record || Object.values(record).some((child) => nestedHas(child, key));
  }
  return false;
}
