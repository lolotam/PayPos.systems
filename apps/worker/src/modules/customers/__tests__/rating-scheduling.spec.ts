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
const TEN_TO_ELEVEN = everyDay([{ opens: '10:00', closes: '23:00' }]);

it('RT-01 a 15:10 Kuwait visit schedules one request due 16:10 with a 22:30 deadline', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-01T12:10:00.000Z'),
  });
  expect(
    (await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'))).delivered,
  ).toBe(true);
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['day']).toBe('2026-06-01');
  expect(rows[0]?.['status']).toBe('SCHEDULED');
  expect(rows[0]?.['branch_id']).toBe(branchId);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-01T13:10:00.000Z'));
  expect(rows[0]?.['send_deadline']).toEqual(new Date('2026-06-01T19:30:00.000Z'));
});

it('RT-01 a 17:00 visit at another branch moves the same row to that branch and closing', async () => {
  const first = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const second = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_ELEVEN });
  const customer = await f.customer();
  const early = await f.session({
    customerId: customer,
    branchId: first,
    occurredAt: new Date('2026-06-02T12:10:00.000Z'),
  });
  await f.deliver(await f.event(early.sessionId, 'ServiceSessionRecorded'));
  const late = await f.session({
    customerId: customer,
    branchId: second,
    occurredAt: new Date('2026-06-02T14:00:00.000Z'),
  });
  await f.deliver(await f.event(late.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['branch_id']).toBe(second);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-02T15:00:00.000Z'));
  expect(rows[0]?.['send_deadline']).toEqual(new Date('2026-06-02T20:30:00.000Z'));
});

it('RT-01 a session in another business of the same company creates a second request', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const other = await f.otherBusiness();
  const here = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-09T12:10:00.000Z'),
  });
  await f.deliver(await f.event(here.sessionId, 'ServiceSessionRecorded'));
  const there = await f.session({
    customerId: customer,
    businessId: other.businessId,
    branchId: other.branchId,
    occurredAt: new Date('2026-06-09T12:10:00.000Z'),
  });
  await f.deliver(await f.event(there.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(2);
  expect(rows.map((row) => row['day'])).toEqual(['2026-06-09', '2026-06-09']);
});

it('RT-02 a 21:30 visit at a 22:00 close is due at 22:00 with a 22:30 deadline', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-10T18:30:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-10T19:00:00.000Z'));
  expect(rows[0]?.['send_deadline']).toEqual(new Date('2026-06-10T19:30:00.000Z'));
});

it('RT-03 cancelling every line cancels the request and a new active session reopens it', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-03T12:10:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  expect((await f.requests(customer))[0]?.['status']).toBe('SCHEDULED');
  await f.cancelLine(session.lineId);
  await f.deliver(await f.event(session.sessionId, 'ServiceLineChanged'));
  const cancelled = (await f.requests(customer))[0];
  expect(cancelled?.['status']).toBe('CANCELLED');
  expect(cancelled?.['cancel_reason']).toBe('NO_ACTIVE_LINE');
  const again = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-03T13:00:00.000Z'),
  });
  await f.deliver(await f.event(again.sessionId, 'ServiceSessionRecorded'));
  const reopened = (await f.requests(customer))[0];
  expect(reopened?.['status']).toBe('SCHEDULED');
  expect(reopened?.['cancel_reason']).toBeNull();
});

it('RT-03 the same delivery twice and a direct handle keep one row with the same values', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-04T12:10:00.000Z'),
  });
  const event = await f.event(session.sessionId, 'ServiceSessionRecorded');
  expect((await f.deliver(event)).delivered).toBe(true);
  expect((await f.deliver(event)).delivered).toBe(true);
  await f.db.withTenant(f.tenant.company, (tx) => f.consumer.handle(tx, event));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-04T13:10:00.000Z'));
});

it('RT-03 a changed line delivered before its session recording gives the same row', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-05T12:10:00.000Z'),
  });
  const changed = await f.event(session.sessionId, 'ServiceLineChanged');
  const recorded = await f.event(session.sessionId, 'ServiceSessionRecorded');
  await f.deliver(changed);
  await f.deliver(recorded);
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['day']).toBe('2026-06-05');
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-05T13:10:00.000Z'));
});

it('RT-03 cancelling the latest session brings the earlier session back as the latest', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const early = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-06T12:10:00.000Z'),
  });
  await f.deliver(await f.event(early.sessionId, 'ServiceSessionRecorded'));
  const late = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-06T14:00:00.000Z'),
  });
  await f.deliver(await f.event(late.sessionId, 'ServiceSessionRecorded'));
  expect((await f.requests(customer))[0]?.['due_at']).toEqual(new Date('2026-06-06T15:00:00.000Z'));
  await f.cancelLine(late.lineId);
  await f.deliver(await f.event(late.sessionId, 'ServiceLineChanged'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-06T13:10:00.000Z'));
});

it('D-B3 the row is keyed on the branch day, not on the stored business date', async () => {
  const branchId = await f.branch({ timezone: DUBAI, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-07T20:30:00.000Z'),
  });
  const [stored] = await f.owner`SELECT business_date::text AS day FROM service_sessions
    WHERE id=${session.sessionId}`;
  expect(stored?.['day']).toBe('2026-06-07');
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['day']).toBe('2026-06-08');
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-08T18:00:00.000Z'));
});
