import { COMMISSION_INPUTS_CONSUMER_ID } from '@pospay/domain';
import { createLogger } from '@pospay/observability';
import { expect, it } from 'vitest';

import { createDeliverer } from '../../../outbox/deliver.ts';
import { createInAppTestModule } from '../../../outbox/__tests__/late-service-session-inbox.ts';
import {
  A,
  B,
  COUNTED,
  MEMBERSHIP_A,
  MEMBERSHIP_B,
  OWNER_A,
  OWNER_B,
  UNCOUNTED,
  alertMarks,
  asApp,
  db,
  dispatcher,
  eventId,
  failPermanently,
  freshSweep,
  ids,
  markEvent,
  notices,
  owner,
  parkedRow,
  parkAlert,
  pending,
  replicaAlert,
  seedEvent,
  seedOwner,
} from './parked-commission-alert-db.fixture.ts';

async function expectOneNotice(event: string, ownerId: string): Promise<void> {
  expect(await alertMarks(event)).toEqual([{ event_id: event }]);
  const rows = await notices(A.company);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    aggregate_type: 'commission_parked_event',
    aggregate_id: event,
  });
  const payload = rows[0]?.payload;
  expect(payload?.event_id).toBe(event.toLowerCase());
  expect(payload?.event_type).toBe(COUNTED);
  expect(payload?.notification_recipients).toEqual([
    expect.objectContaining({ channel: 'IN_APP', user_id: ownerId }),
  ]);
}

it('raises the owner alert on the next sweep when no alert ran at park time', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(1);
  await seedEvent(A.company, event, COUNTED);
  expect(await dispatcher.dispatchBatch(100, failPermanently)).toBe(1);
  expect((await parkedRow(event))[0]?.parked_at).toBeInstanceOf(Date);
  expect(await alertMarks(event)).toEqual([]);

  await freshSweep()();
  await expectOneNotice(event, OWNER_A);

  await freshSweep()();
  expect(await notices(A.company)).toHaveLength(1);
  expect(await alertMarks(event)).toHaveLength(1);
});

it('raises one notice for an event parked by an expired lease at the last attempt', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(2);
  await seedEvent(A.company, event, COUNTED, {
    attempts: 10,
    nextAttemptAt: '2020-01-01T00:00:00Z',
    lastError: 'synthetic lease expiry',
  });
  await dispatcher.dispatchBatch(100, failPermanently, { maxAttempts: 10 });
  expect((await parkedRow(event))[0]?.parked_at).toBeInstanceOf(Date);

  await freshSweep()();
  await expectOneNotice(event, OWNER_A);
});

it('never returns a parked event of another type and raises nothing for it', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(4);
  await seedEvent(A.company, event, UNCOUNTED);
  await dispatcher.dispatchBatch(100, failPermanently);
  expect((await parkedRow(event))[0]?.parked_at).toBeInstanceOf(Date);

  const page = await dispatcher.commissionParkedEventPage('0', 100);
  expect(page.map((row) => row.id)).not.toContain(event);
  await freshSweep()();
  expect(await alertMarks(event)).toEqual([]);
  expect(await notices(A.company)).toEqual([]);
});

it('raises nothing for a company with no owner, and raises once an owner exists', async () => {
  const event = eventId(5);
  await seedEvent(A.company, event, COUNTED);
  await dispatcher.dispatchBatch(100, failPermanently);

  await freshSweep()();
  await freshSweep()();
  expect(await alertMarks(event)).toEqual([]);
  expect(await notices(A.company)).toEqual([]);

  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  await freshSweep()();
  await expectOneNotice(event, OWNER_A);
});

it('gives the owners of another company nothing and hides the mark from them', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  await seedOwner(B.company, MEMBERSHIP_B, OWNER_B);
  const event = eventId(6);
  await seedEvent(A.company, event, COUNTED);
  await dispatcher.dispatchBatch(100, failPermanently);
  await freshSweep()();

  expect(await alertMarks(event)).toEqual([{ event_id: event }]);
  expect(await notices(A.company)).toHaveLength(1);
  expect(await notices(B.company)).toEqual([]);
  const inA = await asApp(A.company, (tx) =>
    tx<{ n: string }[]>`SELECT count(*)::text AS n FROM consumed_events WHERE event_id = ${event}`,
  );
  const inB = await asApp(B.company, (tx) =>
    tx<{ n: string }[]>`SELECT count(*)::text AS n FROM consumed_events WHERE event_id = ${event}`,
  );
  expect(inA[0]?.n).toBe('1');
  expect(inB[0]?.n).toBe('0');
});

it('keeps the parked event pending for the approval after the alert', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(7);
  await seedEvent(A.company, event, COUNTED);
  await dispatcher.dispatchBatch(100, failPermanently);
  await freshSweep()();

  expect(await alertMarks(event)).toEqual([{ event_id: event }]);
  expect(await asApp(A.company, (tx) => pending(tx))).toBe('1');
});

it('does not stop the page when one alert fails, and retries it on the next sweep', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const first = eventId(8);
  const second = eventId(9);
  await seedEvent(A.company, first, COUNTED);
  await seedEvent(A.company, second, COUNTED);
  await dispatcher.dispatchBatch(100, failPermanently);

  let failing = true;
  const sweep = freshSweep({
    raiseAlert: async (event) => {
      if (failing && event.eventId === first) throw new Error('synthetic alert failure');
      return parkAlert(event);
    },
  });
  await sweep();
  expect(await alertMarks(first)).toEqual([]);
  expect(await alertMarks(second)).toHaveLength(1);

  failing = false;
  await freshSweep()();
  expect(await alertMarks(first)).toHaveLength(1);
  expect(await notices(A.company)).toHaveLength(2);
});

it('writes no second notice when the process stopped before the event was settled', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(10);
  await seedEvent(A.company, event, COUNTED);
  await dispatcher.dispatchBatch(100, failPermanently);

  expect(await parkAlert({ companyId: A.company, eventId: event, eventType: COUNTED })).toBe(
    'ALERTED',
  );
  await freshSweep()();
  expect(await notices(A.company)).toHaveLength(1);
  expect(await alertMarks(event)).toHaveLength(1);
});

it('lets two replicas race on one parked event and writes one notice only', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(11);
  await seedEvent(A.company, event, COUNTED);
  await dispatcher.dispatchBatch(100, failPermanently);

  const replica = await replicaAlert();
  try {
    const first = freshSweep();
    const second = freshSweep({ raiseAlert: replica.alert });
    await Promise.all([first(), second()]);
  } finally {
    await replica.close();
  }

  expect(await notices(A.company)).toHaveLength(1);
  expect(await alertMarks(event)).toHaveLength(1);
});

it('marks a projected parked event without a notice, and it no longer blocks the approval', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(12);
  await seedEvent(A.company, event, COUNTED);
  await markEvent(A.company, event, COMMISSION_INPUTS_CONSUMER_ID);
  await dispatcher.dispatchBatch(100, failPermanently);

  await freshSweep()();
  expect(await alertMarks(event)).toHaveLength(1);
  expect(await notices(A.company)).toEqual([]);
  expect(await asApp(A.company, (tx) => pending(tx))).toBe('0');
});

it('alerts a late park below the cursor on the next sweep', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const early = eventId(13);
  const late = eventId(14);
  await seedEvent(A.company, early, COUNTED);
  await seedEvent(A.company, late, COUNTED);
  // الحدث الأحدث في الترتيب وقف الأول، والحدث الأقدم وقف بعد ما المسح عدّى فوقه.
  await owner`UPDATE outbox SET parked_at = now() WHERE id = ${late}`;
  await freshSweep()();
  expect(await alertMarks(late)).toHaveLength(1);
  expect(await alertMarks(early)).toEqual([]);

  await owner`UPDATE outbox SET parked_at = now() WHERE id = ${early}`;
  await freshSweep()();
  expect(await alertMarks(early)).toHaveLength(1);
});

it('turns the parked notice into one in-app row per owner', async () => {
  await seedOwner(A.company, MEMBERSHIP_A, OWNER_A);
  const event = eventId(15);
  await seedEvent(A.company, event, COUNTED);
  await dispatcher.dispatchBatch(100, failPermanently);
  await freshSweep()();

  const [bell] = await notices(A.company);
  if (bell === undefined) throw new Error('the parked notice is required');
  const inApp = createInAppTestModule(db, ids, { now: () => new Date() });
  const deliverer = createDeliverer(db, [inApp.consumer], createLogger('silent'), {
    knownEventTypes: inApp.eventTypes,
  });
  expect(
    await deliverer({
      companyId: A.company,
      id: bell.id,
      aggregateType: 'commission_parked_event',
      aggregateId: event,
      eventType: 'CommissionEventParkedNoticeRequested',
      payload: bell.payload,
      attempt: 1,
    }),
  ).toEqual({ delivered: true });

  const rows = await owner`SELECT recipient_user_id, template_key, template_revision
    FROM in_app_notifications WHERE company_id = ${A.company} AND source_event_id = ${bell.id}`;
  expect(rows.map((row) => row.recipient_user_id)).toEqual([OWNER_A]);
  expect(rows[0]).toMatchObject({
    template_key: 'commission_event_parked',
    template_revision: 1,
  });
});
