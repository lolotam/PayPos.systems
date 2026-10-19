import { afterAll, beforeAll, expect, it } from 'vitest';
import { inAppNotificationPage, recordServiceSessionResponse } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import { SYSTEM_ROLES } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { createLineCancelNoticeConsumer } from '../../../../../worker/src/modules/orders/index.ts';
import { createInAppTestModule } from '../../../../../worker/src/outbox/__tests__/late-service-session-inbox.ts';
import { createDeliverer } from '../../../../../worker/src/outbox/deliver.ts';
import { AT, ids, must, editFixture, type EditFixture } from './session.fixture.ts';

let f: EditFixture;
const PHONE = '+999999998123';
const CUSTOMER = 'Synthetic customer';
const clock = { now: () => AT };
beforeAll(async () => {
  f = await editFixture();
});
afterAll(async () => {
  await f?.close();
});

const input = (reason = 'Synthetic cancel reason') => ({ reason, expected_revision: 1 });
const cancelUrl = (sessionId: string, lineId: string) =>
  `/v1/businesses/${f.business}/branches/${f.branch}/service-sessions/${sessionId}/lines/${lineId}/cancellation`;

it('LC-11 one cancel rings the four scoped managers, including the canceller, and nobody else', async () => {
  const general = await manager(
    'session-gm-cancel@example.test',
    'general_manager',
    'COMPANY',
    f.company,
  );
  const business = await manager(
    'session-bm-cancel@example.test',
    'business_manager',
    'BUSINESS',
    f.business,
  );
  const otherBranch = await manager(
    'session-other-branch-cancel@example.test',
    'branch_manager',
    'BRANCH',
    f.secondBranch,
  );
  const custom = await observer('session-observer-cancel@example.test');
  const reason = `sentinel-${ids.newId()}`;
  const visit = await savedVisit();
  const key = ids.newId();
  const first = await post(visit, reason, f.editorCookie, key);
  const replay = await post(visit, reason, f.editorCookie, key);
  expect(first.status).toBe(200);
  expect(replay.body).toEqual(first.body);
  const sourceId = await deliver(visit.sessionId, visit.lineId);
  const recipients = await recipientIds(sourceId);
  expect(recipients).toEqual([f.ownerId, general.userId, business.userId, f.editorId].sort());
  for (const outsider of [f.userId, otherBranch.userId, custom.userId])
    expect(recipients).not.toContain(outsider);
  const inbox = inAppNotificationPage.parse(
    (
      await f.h.send('GET', '/v1/me/notifications', {
        cookie: f.editorCookie,
        company: f.company,
      })
    ).body,
  );
  const notices = inbox.items.filter((item) => item.template_key === 'service_line_cancelled');
  expect(notices.length).toBeGreaterThan(0);
  expect(
    notices.every((item) =>
      item.safe_parameters.some(
        (parameter) => parameter.name === 'cancelled_net' && parameter.value === '25.000',
      ),
    ),
  ).toBe(true);
  await expectQuiet(visit.sessionId, visit.lineId, sourceId, reason);
  expect(
    await f.h.owner`SELECT id FROM notification_attempts WHERE source_event_id=${sourceId}`,
  ).toHaveLength(0);
  expect(await noticeRows(visit.sessionId, visit.lineId)).toHaveLength(1);
  expect(await ledger(visit.lineId)).toHaveLength(1);
}, 60_000);

it('LC-11 a second line of the same visit rings again', async () => {
  const recorded = await f.h.send('POST', f.base, {
    cookie: f.ownerCookie,
    company: f.company,
    key: ids.newId(),
    body: { customer_id: f.customer, lines: [f.line(), f.line(must(f.services[3]), '15.000')] },
  });
  expect(recorded.status).toBe(201);
  const session = recordServiceSessionResponse.parse(recorded.body).session;
  const first = { sessionId: session.id, lineId: must(session.lines[0]).id };
  const second = { sessionId: session.id, lineId: must(session.lines[1]).id };
  expect((await post(first, 'Synthetic cancel reason')).status).toBe(200);
  expect((await post(second, 'Synthetic cancel reason')).status).toBe(200);
  const firstSource = await deliver(first.sessionId, first.lineId);
  const secondSource = await deliver(second.sessionId, second.lineId);
  expect(firstSource).not.toBe(secondSource);
  expect(await recipientIds(secondSource)).toEqual(await recipientIds(firstSource));
  expect(await ledger(first.lineId)).toHaveLength(1);
  expect(await ledger(second.lineId)).toHaveLength(1);
  expect(await noticeRows(session.id, second.lineId)).toHaveLength(1);
}, 60_000);

it('LC-11 no manager in scope records a ledger row with count 0 and no notice', async () => {
  // قيد آخر مالك يمنع إنهاء عضوية المالك. نافذة الجرس هي ساعة المستهلك، وكل العضويات تبدأ 2026-01-01.
  const beforeMemberships = { now: () => new Date('2025-12-31T00:00:00.000Z') };
  const canceller = await cancelOnly('session-zero-manager-cancel@example.test');
  const visit = await savedVisit();
  expect((await post(visit, 'Synthetic cancel reason', canceller)).status).toBe(200);
  const consumer = createLineCancelNoticeConsumer(ids, beforeMemberships);
  const deliverer = createDeliverer(f.db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  const event = await changedEvent(visit.sessionId, visit.lineId);
  expect(await deliverer(event)).toEqual({ delivered: true });
  expect(await ledger(visit.lineId)).toMatchObject([{ recipient_count: 0 }]);
  expect(await noticeRows(visit.sessionId, visit.lineId)).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT n.id FROM in_app_notifications n JOIN outbox o ON o.company_id=n.company_id AND o.id=n.source_event_id
      WHERE n.company_id=${f.company} AND o.aggregate_id=${visit.sessionId} AND o.payload->>'line_id'=${visit.lineId}`,
  ).toHaveLength(0);
}, 60_000);

async function savedVisit() {
  const response = await f.h.send('POST', f.base, {
    cookie: f.ownerCookie,
    company: f.company,
    key: ids.newId(),
    body: { customer_id: f.customer, lines: [f.line()] },
  });
  expect(response.status).toBe(201);
  const session = recordServiceSessionResponse.parse(response.body).session;
  return { sessionId: session.id, lineId: must(session.lines[0]).id };
}

function post(
  visit: { sessionId: string; lineId: string },
  reason: string,
  cookie = f.editorCookie,
  key = ids.newId(),
) {
  return f.h.send('POST', cancelUrl(visit.sessionId, visit.lineId), {
    cookie,
    company: f.company,
    key,
    body: input(reason),
  });
}

async function deliver(sessionId: string, lineId: string) {
  const consumer = createLineCancelNoticeConsumer(ids, clock);
  const notices = createDeliverer(f.db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  const event = await changedEvent(sessionId, lineId);
  expect(await notices(event)).toEqual({ delivered: true });
  const requests = await noticeRows(sessionId, lineId);
  expect(requests).toHaveLength(1);
  const request = must(requests[0]);
  const module = createInAppTestModule(f.db, ids, clock);
  const inbox = createDeliverer(f.db, [module.consumer], createLogger('silent'), {
    knownEventTypes: module.eventTypes,
  });
  expect(
    await inbox({
      ...event,
      id: request['id'] as string,
      eventType: 'ServiceLineCancelNoticeRequested',
      payload: request['payload'],
    }),
  ).toEqual({ delivered: true });
  return request['id'] as string;
}

async function changedEvent(sessionId: string, lineId: string): Promise<ClaimedEvent> {
  const rows = await f.h
    .owner`SELECT * FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId}
    AND event_type='ServiceLineChanged' AND payload->>'line_id'=${lineId}`;
  expect(rows).toHaveLength(1);
  const row = must(rows[0]);
  return {
    companyId: f.company,
    id: row['id'] as string,
    aggregateType: 'service_session',
    aggregateId: sessionId,
    eventType: 'ServiceLineChanged',
    payload: row['payload'],
    attempt: 1,
  };
}

function noticeRows(sessionId: string, lineId: string) {
  return f.h.owner`SELECT * FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId}
    AND event_type='ServiceLineCancelNoticeRequested' AND payload->>'line_id'=${lineId}`;
}

function ledger(lineId: string) {
  return f.h
    .owner`SELECT recipient_count FROM service_line_cancel_notices WHERE company_id=${f.company} AND line_id=${lineId}`;
}

async function recipientIds(sourceId: string) {
  const rows = await f.h.owner`SELECT DISTINCT recipient_user_id FROM in_app_notifications
    WHERE company_id=${f.company} AND source_event_id=${sourceId}`;
  return rows.map((row) => row['recipient_user_id'] as string).sort();
}

async function expectQuiet(sessionId: string, lineId: string, sourceId: string, reason: string) {
  const events = await f.h
    .owner`SELECT payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId}
    AND event_type='ServiceLineChanged' AND payload->>'line_id'=${lineId}`;
  const audits = await f.h.owner`SELECT before, after FROM audit_log
    WHERE company_id=${f.company} AND entity_id=${lineId} AND action='service_line.cancelled'`;
  const requests = await noticeRows(sessionId, lineId);
  const [bell] = await f.h.owner`SELECT safe_parameters FROM in_app_notifications
    WHERE company_id=${f.company} AND source_event_id=${sourceId} LIMIT 1`;
  const packed = JSON.stringify({ events, audits, requests, bell: bell?.['safe_parameters'] });
  expect(packed).not.toContain(reason);
  expect(packed).not.toContain(PHONE);
  expect(packed).not.toContain(CUSTOMER);
}

async function manager(
  email: string,
  code: 'general_manager' | 'business_manager' | 'branch_manager',
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
) {
  const userId = await userOf(email);
  const role = must(SYSTEM_ROLES.find((item) => item.code === code)).id;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${ids.newId()},${userId},${role},'global',${scopeType},${scopeId},10000,'2026-01-01T00:00:00Z')`;
  return { userId };
}

async function observer(email: string) {
  const userId = await userOf(email);
  const role = ids.newId();
  await f.h
    .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.company},'synthetic_observer','Synthetic observer')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${ids.newId()},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  return { userId };
}

async function cancelOnly(email: string) {
  const cookie = await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  const userId = must(users[0])['id'] as string;
  const role = ids.newId();
  await f.h
    .owner`INSERT INTO roles(id,company_id,code,name_en) VALUES(${role},${f.company},'synthetic_line_canceller','Synthetic canceller')`;
  await f.h.owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
    VALUES(${role},${f.company},${f.company},'cancel:service-lines:branch')`;
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${ids.newId()},${userId},${role},${f.company},'BRANCH',${f.branch},10000,'2026-01-01T00:00:00Z')`;
  return cookie;
}

async function userOf(email: string) {
  await f.h.signedInOperator(email);
  const users = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  return must(users[0])['id'] as string;
}
