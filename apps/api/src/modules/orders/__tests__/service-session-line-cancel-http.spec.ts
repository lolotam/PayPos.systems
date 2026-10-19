import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  cancelServiceLineResponseFull,
  cancelServiceLineResponseNarrow,
  recordServiceSessionResponse,
  serviceSessionDayPage,
} from '@pospay/contracts';
import { serviceSessionErrors } from '@pospay/i18n';
import { origin, paired } from '../../../../test/staff-otp-harness.ts';
import { AT, ids, must, editFixture, type EditFixture } from './session.fixture.ts';

let f: EditFixture;
let narrowCookie = '';
beforeAll(async () => {
  f = await editFixture({ ordersClock: { now: () => f?.clock.now() ?? AT } });
  narrowCookie = await cancelOnlyCookie();
});
afterAll(async () => {
  await f?.close();
});

const PHONE = '+999999998123';
const CUSTOMER = 'Synthetic customer';
const HIDDEN = ['reason', 'canceller_name_ar', 'canceller_name_en', 'canceller_role', 'phone'];
const input = (expected = 1, reason: string | null = 'Synthetic cancel reason') => ({
  ...(reason === null ? {} : { reason }),
  expected_revision: expected,
});
const url = (sessionId: string, lineId: string, branch = f.branch, business = f.business) =>
  `/v1/businesses/${business}/branches/${branch}/service-sessions/${sessionId}/lines/${lineId}/cancellation`;
const post = (
  target: string,
  body: object,
  cookie = f.editorCookie,
  key = ids.newId(),
  company = f.company,
) => f.h.send('POST', target, { cookie, company, key, body });

it('a reader gets status and cancelled_at, a read-less caller gets cancelled only, and the replay writes once', async () => {
  const reason = `sentinel-${ids.newId()}`;
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  const key = ids.newId();
  const first = await post(target, input(1, reason), f.editorCookie, key);
  const replay = await post(target, input(1, reason), f.editorCookie, key);
  expect(first.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  const parsed = cancelServiceLineResponseFull.parse(first.body);
  expect(parsed.line.status).toBe('CANCELLED');
  expect(parsed.line.cancelled_at).toBeTruthy();
  expect(Object.keys(parsed.session).sort()).toEqual(['id', 'total_net']);
  expect(JSON.stringify(first.body)).not.toContain(reason);
  expect(JSON.stringify(first.body)).not.toContain(PHONE);
  expect(JSON.stringify(first.body)).not.toContain(CUSTOMER);
  for (const field of HIDDEN) expect(nestedHas(first.body, field)).toBe(false);
  const day = serviceSessionDayPage.parse((await dayOf('2026-10-14', f.ownerCookie)).body);
  const editorDay = serviceSessionDayPage.parse((await dayOf('2026-10-14', f.editorCookie)).body);
  const line = must(
    must(day.items.find((row) => row.id === visit.sessionId)).lines.find(
      (item) => item.id === visit.lineId,
    ),
  );
  const editorLine = must(
    must(editorDay.items.find((row) => row.id === visit.sessionId)).lines.find(
      (item) => item.id === visit.lineId,
    ),
  );
  expect(line.status).toBe('CANCELLED');
  expect(Date.parse(must(line.cancelled_at))).toBe(Date.parse(parsed.line.cancelled_at));
  expect(editorLine).toMatchObject({ status: 'CANCELLED', cancelled_at: line.cancelled_at });
  expect((await dayOf('2026-10-14', f.cookie)).status).toBe(403);
  expect((await dayOf('2026-10-14', narrowCookie)).status).toBe(403);
  const rows = await f.h
    .owner`SELECT count(*)::int AS n FROM service_line_cancellations WHERE company_id=${f.company} AND line_id=${visit.lineId}`;
  expect(rows[0]?.['n']).toBe(1);
  await expectPrivate(visit.sessionId, visit.lineId, key, reason);
  const again = await post(target, input(2, reason));
  expect(again.status).toBe(422);
  expect(again.body).toMatchObject({
    code: 'SESSION_LINE_ALREADY_CANCELLED',
    ...serviceSessionErrors.SESSION_LINE_ALREADY_CANCELLED,
  });
}, 60_000);

it('a caller with cancel and without branch read gets only cancelled, including the replay', async () => {
  const visit = await savedVisit();
  const reason = `sentinel-${ids.newId()}`;
  const key = ids.newId();
  const target = url(visit.sessionId, visit.lineId);
  const first = await post(target, input(1, reason), narrowCookie, key);
  const replay = await post(target, input(1, reason), narrowCookie, key);
  expect(first.status).toBe(200);
  expect(cancelServiceLineResponseNarrow.parse(first.body)).toEqual({ cancelled: true });
  expect(replay.body).toEqual(first.body);
  expect(Object.keys(first.body as object).sort()).toEqual(['cancelled']);
  expect(JSON.stringify(first.body)).not.toContain(reason);
  expect(JSON.stringify(first.body)).not.toMatch(/\d\.\d{3}/);
  for (const field of [...HIDDEN, 'status', 'cancelled_at', 'price', 'net', 'total_net']) {
    expect(nestedHas(first.body, field)).toBe(false);
  }
});

it('LC-10 trims the reason to 1…500 characters and a bad shape stays 400', async () => {
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  for (const reason of [null, '', ' \t\r\n ', 'ا'.repeat(501)]) {
    const refused = await post(target, input(1, reason));
    expect(refused.status).toBe(422);
    expect(refused.body).toMatchObject({
      code: 'SESSION_CANCEL_REASON_INVALID',
      ...serviceSessionErrors.SESSION_CANCEL_REASON_INVALID,
    });
  }
  const trimmed = await post(target, input(1, ' \tkept\r\n '));
  expect(trimmed.status).toBe(200);
  const stored = await f.h
    .owner`SELECT reason FROM service_line_cancellations WHERE company_id=${f.company} AND line_id=${visit.lineId}`;
  expect(stored).toEqual([{ reason: 'kept' }]);
  const longVisit = await savedVisit();
  const longReason = 'ا'.repeat(500);
  expect(
    (await post(url(longVisit.sessionId, longVisit.lineId), input(1, longReason))).status,
  ).toBe(200);
  const longStored = await f.h.owner`SELECT reason FROM service_line_cancellations
    WHERE company_id=${f.company} AND line_id=${longVisit.lineId}`;
  expect(longStored[0]?.['reason']).toBe(longReason);
  expect((await post(target, { ...input(), note: 'extra' })).body['code']).toBe(
    'VALIDATION_FAILED',
  );
  expect((await post(target, { ...input(), expected_revision: 0 })).status).toBe(400);
});

it('LC-08 a session before the previous month is 422 and the first of that month still cancels', async () => {
  const stale = await savedVisit('2026-09-30T08:00:00.000Z');
  const edge = await savedVisit('2026-10-01T00:00:00.000Z');
  f.setAt(new Date('2026-11-01T00:00:00.000Z'));
  try {
    const tooOld = await post(url(stale.sessionId, stale.lineId), input());
    expect(tooOld.status).toBe(422);
    expect(tooOld.body).toMatchObject({
      code: 'SESSION_TIME_TOO_OLD',
      ...serviceSessionErrors.SESSION_TIME_TOO_OLD,
    });
    const accepted = await post(url(edge.sessionId, edge.lineId), input());
    expect(accepted.status).toBe(200);
    expect(cancelServiceLineResponseFull.parse(accepted.body).line.status).toBe('CANCELLED');
  } finally {
    f.setAt(AT);
  }
});

it('a stale revision is 409 with current_revision only, then the current revision saves', async () => {
  const visit = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  const stale = await post(target, input(9), narrowCookie);
  expect(stale.status).toBe(409);
  expect(stale.body).toMatchObject({
    code: 'SESSION_LINE_REVISION_STALE',
    ...serviceSessionErrors.SESSION_LINE_REVISION_STALE,
    details: { current_revision: 1 },
  });
  expect(Object.keys(stale.body['details'] as object)).toEqual(['current_revision']);
  expect(JSON.stringify(stale.body['details'])).not.toMatch(/\d\.\d{3}/);
  expect((await post(target, input(1), narrowCookie)).body).toEqual({ cancelled: true });
  expect((await post(target, input(1), narrowCookie)).status).toBe(409);
});

it('route refuses a missing key, a device, the wrong permission, a disabled feature, and a foreign line', async () => {
  const visit = await savedVisit();
  const other = await savedVisit();
  const target = url(visit.sessionId, visit.lineId);
  const missing = await f.h.send('POST', target, {
    cookie: f.editorCookie,
    company: f.company,
    body: input(),
  });
  expect(missing.status).toBe(400);
  expect(missing.body['code']).toBe('IDEMPOTENCY_KEY_REQUIRED');
  const device = await paired(f.h, f.ownerCookie, f.company, f.branch);
  const deviceReply = await f.h.app.inject({
    method: 'POST',
    url: target,
    payload: input(),
    headers: {
      authorization: `Device ${device.token}`,
      origin,
      'x-company-id': f.company,
      'idempotency-key': ids.newId(),
    },
  });
  expect(deviceReply.statusCode).toBe(403);
  expect(deviceReply.json().code).toBe('FORBIDDEN');
  expect((await post(target, input(), f.cookie)).status).toBe(403);
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'orders',false,'Synthetic cancel feature',${f.ownerId})`;
  try {
    const disabled = await post(target, input());
    expect(disabled.status).toBe(403);
    expect(disabled.body['code']).toBe('FEATURE_DISABLED');
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='orders'`;
  }
  const foreign = [
    await post(url(visit.sessionId, ids.newId()), input()),
    await post(url(visit.sessionId, other.lineId), input()),
    await post(url(ids.newId(), visit.lineId), input()),
    await post(url(visit.sessionId, visit.lineId, f.secondBranch), input(), f.ownerCookie),
    await post(
      url(visit.sessionId, visit.lineId, f.foreignBranch, f.foreignBusiness),
      input(),
      f.ownerCookie,
    ),
    await post(target, input(), f.ownerCookie, ids.newId(), f.otherCompany),
  ];
  const body = JSON.stringify(foreign[0]?.body);
  expect(
    foreign.every((reply) => reply.status === 403 && JSON.stringify(reply.body) === body),
  ).toBe(true);
  expect(foreign[0]?.body['code']).toBe('FORBIDDEN');
});

it('the idempotency fingerprint binds the line: one key on another line or with another body is reused', async () => {
  const recorded = await f.h.send('POST', f.base, {
    cookie: f.ownerCookie,
    company: f.company,
    key: ids.newId(),
    body: {
      customer_id: f.customer,
      occurred_at: '2026-10-14T08:00:00.000Z',
      lines: [f.line(), f.line(must(f.services[3]), '15.000')],
    },
  });
  expect(recorded.status).toBe(201);
  const session = recordServiceSessionResponse.parse(recorded.body).session;
  const first = must(session.lines[0]);
  const second = must(session.lines[1]);
  const key = ids.newId();
  expect((await post(url(session.id, first.id), input(1), f.editorCookie, key)).status).toBe(200);
  const otherLine = await post(url(session.id, second.id), input(1), f.editorCookie, key);
  expect(otherLine.status).toBe(422);
  expect(otherLine.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  const otherBody = await post(
    url(session.id, first.id),
    input(1, 'Another synthetic reason'),
    f.editorCookie,
    key,
  );
  expect(otherBody.status).toBe(422);
  expect(otherBody.body['code']).toBe('IDEMPOTENCY_KEY_REUSED');
  const sibling = serviceSessionDayPage.parse((await dayOf('2026-10-14', f.ownerCookie)).body);
  const open = must(
    must(sibling.items.find((row) => row.id === session.id)).lines.find(
      (line) => line.id === second.id,
    ),
  );
  expect(open.status).toBe('ACTIVE');
  expect(open.cancelled_at).toBeUndefined();
  expect((await post(url(session.id, second.id), input(1))).status).toBe(200);
});

async function savedVisit(occurredAt = '2026-10-14T08:00:00.000Z') {
  const response = await f.h.send('POST', f.base, {
    cookie: f.ownerCookie,
    company: f.company,
    key: ids.newId(),
    body: { customer_id: f.customer, occurred_at: occurredAt, lines: [f.line()] },
  });
  expect(response.status).toBe(201);
  const session = recordServiceSessionResponse.parse(response.body).session;
  return { sessionId: session.id, lineId: must(session.lines[0]).id };
}

function dayOf(date: string, cookie: string) {
  return f.h.send('GET', `${f.base}?date=${date}`, { cookie, company: f.company });
}

async function expectPrivate(sessionId: string, lineId: string, key: string, reason: string) {
  const events = await f.h.owner`SELECT payload FROM outbox
    WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='ServiceLineChanged'`;
  const audits = await f.h.owner`SELECT before, after FROM audit_log
    WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.cancelled'`;
  const [stored] = await f.h
    .owner`SELECT response_body FROM idempotency_keys WHERE company_id=${f.company} AND key=${key}`;
  const packed = JSON.stringify({ events, audits, stored: stored?.['response_body'] });
  expect(packed).not.toContain(reason);
  expect(packed).not.toContain(PHONE);
  expect(packed).not.toContain(CUSTOMER);
  expect(events).toHaveLength(1);
  expect(audits).toHaveLength(1);
}

async function cancelOnlyCookie() {
  const cookie = await f.h.signedInOperator('session-readless-canceller@example.test');
  const users = await f.h
    .owner`SELECT id FROM "user" WHERE email='session-readless-canceller@example.test'`;
  const userId = must(users[0])['id'] as string;
  const role = ids.newId();
  const membership = ids.newId();
  await f.h
    .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.company},'synthetic_line_canceller','Synthetic canceller')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES(${role},${f.company},${f.company},'cancel:service-lines:branch')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membership},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
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
