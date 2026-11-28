import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  everyDay,
  ratingSchedulingFixture,
  type RatingSchedulingFixture,
} from './rating-scheduling.fixture.ts';

let f: RatingSchedulingFixture;
beforeAll(async () => {
  f = await ratingSchedulingFixture();
});
afterAll(async () => {
  await f?.close();
});

const KUWAIT = 'Asia/Kuwait';
const DUBAI = 'Asia/Dubai';
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);
const TEN_TO_LATE = everyDay([{ opens: '10:00', closes: '23:59' }]);
const SPLIT_DAY = everyDay([
  { opens: '10:00', closes: '13:00' },
  { opens: '16:00', closes: '22:00' },
]);
const OVERNIGHT = everyDay([{ opens: '18:00', closes: '02:00' }]);

it('RT-05 a branch without opening hours has no deadline and is due one hour after the visit', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: null });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-11T12:10:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['send_deadline']).toBeNull();
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-11T13:10:00.000Z'));
});

it('RT-05 a day whose only visit is a late entry gets no request', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-12T17:00:00.000Z'),
    recordedAt: new Date('2026-06-12T19:31:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(customer)).toHaveLength(0);
});

it('RT-Q14 a visit recorded 30 minutes after the close is on time and 31 minutes is late', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const onTime = await f.customer();
  const session = await f.session({
    customerId: onTime,
    branchId,
    occurredAt: new Date('2026-06-12T17:00:00.000Z'),
    recordedAt: new Date('2026-06-12T19:30:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(onTime)).toHaveLength(1);
  const late = await f.customer();
  const lateSession = await f.session({
    customerId: late,
    branchId,
    occurredAt: new Date('2026-06-12T17:00:00.000Z'),
    recordedAt: new Date('2026-06-12T19:31:00.000Z'),
  });
  await f.deliver(await f.event(lateSession.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(late)).toHaveLength(0);
});

it('RT-05 a late entry added to a day that already has a request does not move it', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const first = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-12T16:00:00.000Z'),
  });
  await f.deliver(await f.event(first.sessionId, 'ServiceSessionRecorded'));
  const before = (await f.requests(customer))[0];
  const late = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-12T17:00:00.000Z'),
    recordedAt: new Date('2026-06-12T19:31:00.000Z'),
  });
  await f.deliver(await f.event(late.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['due_at']).toEqual(before?.['due_at']);
  expect(rows[0]?.['status']).toBe('SCHEDULED');
});

it('RT-06 a split day uses the 22:00 close of its last interval', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: SPLIT_DAY });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-13T14:00:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-13T15:00:00.000Z'));
  expect(rows[0]?.['send_deadline']).toEqual(new Date('2026-06-13T19:30:00.000Z'));
});

it('RT-06 an overnight day keeps the 23:00 and the 00:30 visits on the start day', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: OVERNIGHT });
  const customer = await f.customer();
  const evening = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T20:00:00.000Z'),
  });
  await f.deliver(await f.event(evening.sessionId, 'ServiceSessionRecorded'));
  const night = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T21:30:00.000Z'),
  });
  await f.deliver(await f.event(night.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['day']).toBe('2026-06-14');
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-14T22:30:00.000Z'));
  expect(rows[0]?.['send_deadline']).toEqual(new Date('2026-06-14T23:30:00.000Z'));
});

it('RT-06 a 22:15 visit at a 22:00 close is due at once with a 22:30 deadline', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-15T19:15:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-15T19:00:00.000Z'));
  expect(rows[0]?.['send_deadline']).toEqual(new Date('2026-06-15T19:30:00.000Z'));
});

it('RT-01b a 23:30 Kuwait visit and a 00:10 Dubai visit make two requests in either order', async () => {
  const kuwait = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_LATE });
  const dubai = await f.branch({ timezone: DUBAI, openingHours: TEN_TO_LATE });
  const customer = await f.customer();
  const late = await f.session({
    customerId: customer,
    branchId: kuwait,
    occurredAt: new Date('2026-06-16T20:30:00.000Z'),
  });
  const early = await f.session({
    customerId: customer,
    branchId: dubai,
    occurredAt: new Date('2026-06-16T20:10:00.000Z'),
  });
  await f.deliver(await f.event(late.sessionId, 'ServiceSessionRecorded'));
  await f.deliver(await f.event(early.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row['day'])).toEqual(['2026-06-16', '2026-06-17']);
  expect(rows.map((row) => row['branch_id'])).toEqual([kuwait, dubai]);
});

it('RT-01b the same two visits in the opposite order give the same two requests', async () => {
  const kuwait = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_LATE });
  const dubai = await f.branch({ timezone: DUBAI, openingHours: TEN_TO_LATE });
  const customer = await f.customer();
  const late = await f.session({
    customerId: customer,
    branchId: kuwait,
    occurredAt: new Date('2026-06-18T20:30:00.000Z'),
  });
  const early = await f.session({
    customerId: customer,
    branchId: dubai,
    occurredAt: new Date('2026-06-18T20:10:00.000Z'),
  });
  await f.deliver(await f.event(early.sessionId, 'ServiceSessionRecorded'));
  await f.deliver(await f.event(late.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row['day'])).toEqual(['2026-06-18', '2026-06-19']);
  expect(rows.map((row) => row['branch_id'])).toEqual([kuwait, dubai]);
});

it('RT-Q15 a visit on a closed weekday schedules one hour later with no deadline', async () => {
  const hours = everyDay([{ opens: '10:00', closes: '22:00' }]).filter((day) => day.weekday !== 5);
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: hours });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-19T09:00:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-19T10:00:00.000Z'));
  expect(rows[0]?.['send_deadline']).toBeNull();
});

it('RT-Q15 a branch with an empty schedule schedules one hour later with no deadline', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: [] });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-21T09:00:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-21T10:00:00.000Z'));
  expect(rows[0]?.['send_deadline']).toBeNull();
});

it('RT-07 a business with the switch off schedules nothing and schedules on the next event', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  f.enabled.on = false;
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-19T12:10:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(customer)).toHaveLength(0);
  f.enabled.on = true;
  const again = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-19T13:00:00.000Z'),
  });
  await f.deliver(await f.event(again.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['status']).toBe('SCHEDULED');
});

it('PP-286 T-3 changing overnight hours keeps the stored rating_request_day across reschedule and bootstrap', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: OVERNIGHT });
  const customer = await f.customer();
  const visit = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T21:15:00.000Z'),
  });
  await f.deliver(await f.event(visit.sessionId, 'ServiceSessionRecorded'));

  const storedSessions =
    await f.owner`SELECT rating_request_day::text AS day FROM service_sessions WHERE id=${visit.sessionId}`;
  expect(storedSessions[0]?.['day']).toBe('2026-06-14');

  const daytime2359 = everyDay([{ opens: '10:00', closes: '23:59' }]);
  await f.owner`UPDATE branches
    SET opening_hours=${f.owner.json(daytime2359 as unknown as Parameters<typeof f.owner.json>[0])}
    WHERE company_id=${f.tenant.company} AND id=${branchId}`;

  f.clock.at = new Date('2026-06-14T21:20:00.000Z');
  await f.deliver(await f.event(visit.sessionId, 'ServiceLineChanged'));
  const afterReschedule = await f.requests(customer);
  expect(afterReschedule).toHaveLength(1);
  expect(afterReschedule[0]?.['day']).toBe('2026-06-14');
  expect(afterReschedule[0]?.['status']).toBe('SCHEDULED');

  const bootstrap = await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: new Date('2026-06-14T00:00:00.000Z'),
  });
  expect(bootstrap.complete).toBe(true);
  const afterBootstrap = await f.requests(customer);
  expect(afterBootstrap).toHaveLength(1);
  expect(afterBootstrap[0]?.['day']).toBe('2026-06-14');
  expect(afterBootstrap[0]?.['status']).toBe('SCHEDULED');
});

it('PP-286 T-3 legacy SENT overnight request anchors a NULL-day visit after overnight hours are removed', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: OVERNIGHT });
  const customer = await f.customer();
  const visit = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T21:30:00.000Z'),
  });
  const requestId = f.ids.newId();
  const dueAt = new Date('2026-06-14T22:30:00.000Z');
  const sendDeadline = new Date('2026-06-14T23:30:00.000Z');
  const expiresAt = new Date(dueAt.getTime() + 168 * 3_600_000);
  await f.owner.begin(async (sqlTx) => {
    await sqlTx`INSERT INTO rating_requests
      (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status)
      VALUES (${f.tenant.company}, ${requestId}, ${f.tenant.business}, ${customer},
        '2026-06-14'::date, ${branchId}, ${dueAt}, ${sendDeadline}, 'SCHEDULED')`;
    await sqlTx`UPDATE rating_requests SET
        status = 'SENDING',
        token_hash = decode(repeat('ab', 32), 'hex'),
        token_key_version = 1,
        claimed_at = ${dueAt},
        expires_at = ${expiresAt},
        ready_event_id = ${f.ids.newId()}
      WHERE company_id = ${f.tenant.company} AND id = ${requestId}`;
    await sqlTx`UPDATE rating_requests SET
        status = 'SENT',
        sent_at = ${new Date('2026-06-14T22:31:00.000Z')}
      WHERE company_id = ${f.tenant.company} AND id = ${requestId}`;
  });

  const daytime2359 = everyDay([{ opens: '10:00', closes: '23:59' }]);
  await f.owner`UPDATE branches
    SET opening_hours=${f.owner.json(daytime2359 as unknown as Parameters<typeof f.owner.json>[0])}
    WHERE company_id=${f.tenant.company} AND id=${branchId}`;

  f.clock.at = new Date('2026-06-14T22:40:00.000Z');
  await f.deliver(await f.event(visit.sessionId, 'ServiceLineChanged'));
  const bootstrap = await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: new Date('2026-06-14T00:00:00.000Z'),
  });
  expect(bootstrap.complete).toBe(true);

  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['day']).toBe('2026-06-14');
  expect(rows[0]?.['status']).toBe('SENT');
  const stored =
    await f.owner`SELECT rating_request_day::text AS day FROM service_sessions WHERE id=${visit.sessionId}`;
  expect(stored[0]?.['day']).toBe('2026-06-14');
});
