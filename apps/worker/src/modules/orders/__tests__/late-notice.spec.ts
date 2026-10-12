import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import { createLogger } from '@pospay/observability';
import { createDeliverer } from '../../../outbox/deliver.ts';
import { lateNoticeRecipients } from '../persistence/branch-manager-recipients.adapter.ts';
import { lateNoticePlace } from '../persistence/branch-place.adapter.ts';
import {
  lateNoticeRepository,
  lateNoticeOutbox,
} from '../persistence/late-service-session-notice.repository.ts';
import { RequestLateServiceSessionNotice } from '../use-cases/request-late-service-session-notice/request-late-service-session-notice.ts';
import { onLateServiceSession } from '../events/handlers/on-late-service-session.handler.ts';
import { beforeAll, afterAll, expect, it } from 'vitest';
import { lateServiceSessionNoticeRequested } from '@pospay/contracts';
import { USER, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { lateNoticeFixture, type LateNoticeFixture } from './late-notice.fixture.ts';
let f: LateNoticeFixture;
beforeAll(async () => {
  f = await lateNoticeFixture();
});
afterAll(async () => {
  await f?.close();
});

it('late recording and further appends/replays yield one durable request; on-time produces none', async () => {
  const id = await f.session();
  const first = await f.event(id);
  expect(await f.deliver(first)).toEqual({ delivered: true });
  expect(await f.deliver(first)).toEqual({ delivered: true });
  await f.consume(first);
  await f.deliver(await f.event(id, true, 'ServiceSessionLinesAdded'));
  expect(await f.notices(id)).toMatchObject([{ recipient_count: 1, source_event_id: first.id }]);
  const requests = await f.requests(id);
  expect(requests).toHaveLength(1);
  const parsed = lateServiceSessionNoticeRequested.parse(requests[0]?.['payload']);
  expect(parsed.notification_recipients.map((r) => r.user_id)).toEqual([USER]);
  expect(JSON.stringify(parsed)).not.toMatch(/phone|customer|employee|recorded_by|net|price/);
  const onTime = await f.session(false);
  await f.deliver(await f.event(onTime, false));
  expect(await f.notices(onTime)).toHaveLength(0);
  expect(await f.requests(onTime)).toHaveLength(0);
});
it('first late append of an on-time header wins even if inputs arrive reordered', async () => {
  const id = await f.session(false);
  const create = await f.event(id, false);
  await f.deliver(await f.event(id, true, 'ServiceSessionLinesAdded'));
  await f.deliver(create);
  await f.deliver(await f.event(id, true, 'ServiceSessionLinesAdded'));
  expect(await f.requests(id)).toHaveLength(1);
});
it('distinct concurrent event IDs for one visit choose one claim; different visits each notify', async () => {
  const a = await f.session(),
    b = await f.session();
  const events = [
    await f.event(a),
    await f.event(a, true, 'ServiceSessionLinesAdded'),
    await f.event(b),
  ];
  expect(await Promise.all(events.map(f.deliver))).toEqual(events.map(() => ({ delivered: true })));
  expect(await f.notices(a)).toHaveLength(1);
  expect(await f.requests(a)).toHaveLength(1);
  expect(await f.requests(b)).toHaveLength(1);
});
it('zero recipients is observable and manager added later never gets the historical notice', async () => {
  const empty = createDeliverer(
    f.db,
    [
      {
        ...f.consumer,
        handle: (tx, event) =>
          onLateServiceSession(
            new RequestLateServiceSessionNotice(
              {
                recipients: { ...lateNoticeRecipients(tx), forBranch: async () => [] },
                place: lateNoticePlace(tx),
                repository: lateNoticeRepository(tx),
                outbox: lateNoticeOutbox(tx),
              },
              f.ids,
              { now: () => f.at },
              { ar: 'فرع', en: 'Branch' },
            ),
            event,
          ),
      },
    ],
    createLogger('silent'),
    { knownEventTypes: f.consumer.eventTypes },
  );
  const id = await f.session();
  await empty(await f.event(id));
  expect(await f.notices(id)).toMatchObject([{ recipient_count: 0 }]);
  expect(await f.requests(id)).toHaveLength(0);
  const added = await f.member(await f.user(), 'branch_manager');
  await f.deliver(await f.event(id, true, 'ServiceSessionLinesAdded'));
  expect(await f.requests(id)).toHaveLength(0);
  await f.owner`DELETE FROM memberships WHERE company_id=${f.tenant.company} AND id=${added}`;
});
it('closed company, foreign envelope and mismatched aggregate cannot produce a ledger/request', async () => {
  const id = await f.session();
  const input = await f.event(id);
  expect((await f.deliver({ ...input, aggregateId: f.ids.newId() })).delivered).toBe(false);
  expect((await f.deliver({ ...input, companyId: TENANT.B.company })).delivered).toBe(false);
  expect(await f.notices(id)).toHaveLength(0);
  await f.owner`UPDATE companies SET deleted_at=${f.at} WHERE id=${f.tenant.company}`;
  expect((await f.deliver(input)).delivered).toBe(true);
  expect(await f.notices(id)).toHaveLength(0);
  await f.owner`UPDATE companies SET deleted_at=NULL WHERE id=${f.tenant.company}`;
});
it('production IN_APP-only delivery and direct/concurrent replay store one inbox/result per recipient', async () => {
  const id = await f.session();
  await f.deliver(await f.event(id));
  const [request] = await f.requests(id);
  if (!request) throw new Error('request required');
  const input = {
    companyId: f.tenant.company,
    id: request['id'] as string,
    aggregateType: 'service_session',
    aggregateId: id,
    eventType: 'LateServiceSessionNoticeRequested',
    payload: request['payload'],
    attempt: 1,
  };
  const inApp = createInAppTestModule(f.db, f.ids, { now: () => f.at });
  const notifications = createDeliverer(f.db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  await Promise.all([notifications(input), notifications(input)]);
  await f.db.withTenant(input.companyId, (tx) => inApp.consumer.handle(tx, input));
  const inbox = await f.owner`SELECT * FROM in_app_notifications WHERE source_event_id=${input.id}`;
  expect(inbox).toHaveLength(1);
  expect(inbox[0]).toMatchObject({
    recipient_user_id: USER,
    template_key: 'late_service_session',
    read_at: null,
  });
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='NotificationDelivered' AND payload->>'source_event_id'=${input.id}`,
  ).toHaveLength(1);
  expect(
    await f.owner`SELECT id FROM notification_attempts WHERE source_event_id=${input.id}`,
  ).toHaveLength(0);
  expect(
    await f.owner`SELECT id FROM outbox WHERE aggregate_id=${id} AND event_type IN ('NotificationSendAuthorized','ServiceLineChanged','OrderCompleted')`,
  ).toHaveLength(0);
});
