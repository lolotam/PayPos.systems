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
  const kuwait = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const dubai = await f.branch({ timezone: DUBAI, openingHours: TEN_TO_TEN });
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
  const kuwait = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const dubai = await f.branch({ timezone: DUBAI, openingHours: TEN_TO_TEN });
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
