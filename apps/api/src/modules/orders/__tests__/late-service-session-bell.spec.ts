import { beforeAll, afterAll, expect, it } from 'vitest';
import { inAppNotificationPage } from '@pospay/contracts';
import type { ClaimedEvent } from '@pospay/db';
import { createLogger } from '@pospay/observability';
import { createLateServiceSessionNoticeConsumer } from '../../../../../worker/src/modules/orders/index.ts';
import { createInAppTestModule } from '../../../../../worker/src/outbox/__tests__/late-service-session-inbox.ts';
import { createDeliverer } from '../../../../../worker/src/outbox/deliver.ts';
import { sessionFixture, ids, type SessionFixture } from './session.fixture.ts';
let f: SessionFixture;
beforeAll(async () => {
  f = await sessionFixture();
});
afterAll(async () => {
  await f?.close();
});
it('actual multi-line PARTIAL recording → existing production inbox → manager count/read, unrelated users see none', async () => {
  const result = await f.create.execute({
    ...f.context(),
    input: f.body([
      f.line(),
      f.line(f.services[3], '15.000'),
      f.line(f.services[1], '7.125', '0.713'),
    ]),
  });
  expect(result.outcome).toBe('PARTIAL');
  expect(result.session.lines).toHaveLength(2);
  const sourceRequest = await deliverSessionNotice(result.session.id);
  const get = (cookie: string, path = '') =>
    f.h.send('GET', `/v1/me/notifications${path}`, { cookie, company: f.company });
  const owner = await get(f.ownerCookie);
  expect(owner.status).toBe(200);
  const page = inAppNotificationPage.parse(owner.body);
  expect(page.items).toHaveLength(1);
  expect(page.items[0]?.template_key).toBe('late_service_session');
  expect((await get(f.ownerCookie, '/unread-count')).body).toEqual({ count: 1 });
  expect(inAppNotificationPage.parse((await get(f.cookie)).body).items).toHaveLength(0);
  const read = await f.h.send('POST', `/v1/me/notifications/${page.items[0]?.id}/read`, {
    cookie: f.ownerCookie,
    company: f.company,
  });
  expect(read.status).toBe(200);
  expect((await get(f.ownerCookie, '/unread-count')).body).toEqual({ count: 0 });
  expect(
    await f.h
      .owner`SELECT id FROM notification_attempts WHERE source_event_id=${sourceRequest}`,
  ).toHaveLength(0);
});
it('all-rejected and rolled-back writes produce no session input/notice', async () => {
  const before = await f.h
    .owner`SELECT count(*)::int AS n FROM outbox WHERE company_id=${f.company} AND event_type='ServiceSessionRecorded'`;
  await expect(
    f.create.execute({
      ...f.context(),
      input: f.body([
        f.line(f.services[1], '7.125', '0.713'),
      ]),
    }),
  ).rejects.toThrow();
  expect(
    await f.h
      .owner`SELECT count(*)::int AS n FROM outbox WHERE company_id=${f.company} AND event_type='ServiceSessionRecorded'`,
  ).toEqual(before);
});

async function deliverSessionNotice(sessionId: string) {
  const consumer = createLateServiceSessionNoticeConsumer(ids, f.clock);
  const notices = createDeliverer(f.db, [consumer], createLogger('silent'), {
    knownEventTypes: consumer.eventTypes,
  });
  const module = createInAppTestModule(f.db, ids, f.clock);
  const inbox = createDeliverer(f.db, [module.consumer], createLogger('silent'), {
    knownEventTypes: module.eventTypes,
  });
  const rows = await f.h
    .owner`SELECT * FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId}`;
  expect(rows).toHaveLength(1);
  const row = rows[0];
  if (!row) throw new Error('event required');
  const event: ClaimedEvent = {
    companyId: f.company,
    id: row['id'] as string,
    aggregateType: 'service_session',
    aggregateId: sessionId,
    eventType: 'ServiceSessionRecorded',
    payload: row['payload'],
    attempt: 1,
  };
  expect(await notices(event)).toEqual({ delivered: true });
  const requests = await f.h
    .owner`SELECT id,payload FROM outbox WHERE company_id=${f.company} AND aggregate_id=${sessionId} AND event_type='LateServiceSessionNoticeRequested'`;
  expect(requests).toHaveLength(1);
  const request = requests[0];
  if (!request) throw new Error('request required');
  expect(
    await inbox({
      ...event,
      id: request['id'] as string,
      eventType: 'LateServiceSessionNoticeRequested',
      payload: request['payload'],
    }),
  ).toEqual({ delivered: true });
  return request['id'] as string;
}
