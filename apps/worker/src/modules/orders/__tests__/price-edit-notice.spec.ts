import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import { createLogger } from '@pospay/observability';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { serviceLineEditNoticeRequested } from '@pospay/contracts';
import { USER } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { priceEditFixture, type PriceEditFixture } from './price-edit-notice.fixture.ts';

let f: PriceEditFixture;
beforeAll(async () => {
  f = await priceEditFixture();
});
afterAll(async () => {
  await f?.close();
});

it('test 4: the same event twice, then again without its consumed mark, keeps one ledger row and one notice', async () => {
  const prepared = await f.edit();
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  await f.owner`DELETE FROM consumed_events WHERE company_id=${prepared.companyId} AND consumer_id=${f.consumer.id} AND event_id=${prepared.event.id}`;
  expect(await f.deliver(prepared.event)).toEqual({ delivered: true });
  expect(await f.notices(prepared.lineId)).toMatchObject([
    { recipient_count: 1, revision: 2, source_event_id: prepared.event.id },
  ]);
  const requests = await f.requests(prepared.sessionId);
  expect(requests).toHaveLength(1);
  const parsed = serviceLineEditNoticeRequested.parse(requests[0]?.['payload']);
  expect(parsed.business_timezone).toBe('Asia/Kuwait');
  expect(parsed.notification_recipients.map((recipient) => recipient.user_id)).toEqual([USER]);
  expect(parsed.notification_recipients[0]).toMatchObject({
    channel: 'IN_APP',
    locale: 'ar',
    template_key: 'service_line_price_edited',
    template_revision: 1,
  });
  expect(JSON.stringify(parsed)).not.toContain('recorded reason');
});

it('test 4: two revisions of one line ring twice', async () => {
  const first = await f.edit({ revision: 2, lineRevision: 3 });
  const second = await f.edit({
    revision: 3,
    lineRevision: 3,
    sessionId: first.sessionId,
    lineId: first.lineId,
  });
  expect(await f.deliver(first.event)).toEqual({ delivered: true });
  expect(await f.deliver(second.event)).toEqual({ delivered: true });
  expect(await f.notices(first.lineId)).toHaveLength(2);
  expect(await f.requests(first.sessionId)).toHaveLength(2);
});

it('test 4: two lines of one visit ring twice', async () => {
  const first = await f.edit({ ordinal: 1 });
  const second = await f.edit({ sessionId: first.sessionId, ordinal: 2 });
  expect(await f.deliver(first.event)).toEqual({ delivered: true });
  expect(await f.deliver(second.event)).toEqual({ delivered: true });
  expect(await f.notices(first.lineId)).toHaveLength(1);
  expect(await f.notices(second.lineId)).toHaveLength(1);
  expect(await f.requests(first.sessionId)).toHaveLength(2);
});

it('test 4: the notice becomes one in-app row for its recipient', async () => {
  const prepared = await f.edit();
  await f.deliver(prepared.event);
  const sourceId = await storeInbox(prepared.sessionId);
  const inbox = await f.owner`SELECT recipient_user_id,template_key,locale,read_at FROM in_app_notifications WHERE source_event_id=${sourceId}`;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    recipient_user_id: USER,
    template_key: 'service_line_price_edited',
    locale: 'ar',
    read_at: null,
  });
  expect(await f.owner`SELECT id FROM notification_attempts WHERE source_event_id=${sourceId}`).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='NotificationSendAuthorized' AND payload->>'source_event_id'=${sourceId}`,
  ).toHaveLength(0);
});

async function storeInbox(sessionId: string): Promise<string> {
  const [request] = await f.requests(sessionId);
  if (!request) throw new Error('request required');
  const input = {
    companyId: f.tenant.company,
    id: request['id'] as string,
    aggregateType: 'service_session',
    aggregateId: sessionId,
    eventType: 'ServiceLineEditNoticeRequested',
    payload: request['payload'],
    attempt: 1,
  };
  const inApp = createInAppTestModule(f.db, f.ids, { now: () => f.at });
  const notifications = createDeliverer(f.db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  await notifications(input);
  return input.id;
}
