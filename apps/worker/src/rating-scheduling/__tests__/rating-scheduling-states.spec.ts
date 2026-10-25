import { afterAll, beforeAll, expect, it } from 'vitest';
import { TENANT } from '../../../../../packages/db/test/tenancy-fixtures.ts';
import { ORDER_IDS } from '../../../../../packages/db/test/orders-fixture.ts';
import {
  claimRequest,
  insertRequest,
  RATING_TENANT,
} from '../../../../../packages/db/test/rating-fixtures.ts';
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
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);

/** البصمة فريدة لكل صف مُطالَب؛ عشان كده كل مطالبة في الملف ليها بذرة مختلفة. */
const tokenOf = (seed: number): Buffer => Buffer.alloc(32, seed);

async function scheduledRequest(customer: string, branchId: string, date: string): Promise<string> {
  return insertRequest(f.owner, {
    tenant: { ...RATING_TENANT.A, customer },
    branch: branchId,
    date,
    dueAt: new Date(`${date}T13:10:00.000Z`),
    sendDeadline: new Date(`${date}T19:30:00.000Z`),
    status: 'SCHEDULED',
  });
}

async function claimRequestRow(
  customer: string,
  requestId: string,
  seed: number,
  claimedAt: string,
): Promise<void> {
  await f.db.withTenant(TENANT.A.company, (tx) =>
    claimRequest(tx, {
      tenant: { ...RATING_TENANT.A, customer },
      requestId,
      tokenHash: tokenOf(seed),
      readyEventId: f.ids.newId(),
      now: new Date(claimedAt),
      performers: [],
    }),
  );
}

it('a SENDING row is left untouched by a new session of the same day', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const requestId = await scheduledRequest(customer, branchId, '2026-06-20');
  await claimRequestRow(customer, requestId, 1, '2026-06-20T12:00:00.000Z');
  const before = (await f.requests(customer))[0];
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-20T12:10:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(customer)).toEqual([before]);
  expect(before?.['status']).toBe('SENDING');
});

it('a SENT row is left untouched by a new session of the same day', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const requestId = await scheduledRequest(customer, branchId, '2026-06-21');
  await claimRequestRow(customer, requestId, 2, '2026-06-21T12:00:00.000Z');
  await f.owner`UPDATE rating_requests SET status='SENT',
    sent_at=${new Date('2026-06-21T13:30:00.000Z')}::timestamptz
    WHERE company_id=${TENANT.A.company} AND id=${requestId}`;
  const before = (await f.requests(customer))[0];
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-21T12:10:00.000Z'),
  });
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(customer)).toEqual([before]);
  expect(before?.['status']).toBe('SENT');
});

it('a cancelled row is left untouched by a new session of the same day', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const optedOut = await f.customer();
  await insertRequest(f.owner, {
    tenant: { ...RATING_TENANT.A, customer: optedOut },
    branch: branchId,
    date: '2026-06-21',
    dueAt: new Date('2026-06-21T13:10:00.000Z'),
    sendDeadline: new Date('2026-06-21T19:30:00.000Z'),
    status: 'CANCELLED',
    cancelReason: 'OPTED_OUT',
  });
  const expired = await f.customer();
  await insertRequest(f.owner, {
    tenant: { ...RATING_TENANT.A, customer: expired },
    branch: branchId,
    date: '2026-06-21',
    dueAt: new Date('2026-06-21T13:10:00.000Z'),
    sendDeadline: new Date('2026-06-21T19:30:00.000Z'),
    status: 'CANCELLED',
    cancelReason: 'PAST_DEADLINE',
  });
  const beforeOptedOut = (await f.requests(optedOut))[0];
  const beforeExpired = (await f.requests(expired))[0];
  const first = await f.session({
    customerId: optedOut,
    branchId,
    occurredAt: new Date('2026-06-21T12:10:00.000Z'),
  });
  await f.deliver(await f.event(first.sessionId, 'ServiceSessionRecorded'));
  const second = await f.session({
    customerId: expired,
    branchId,
    occurredAt: new Date('2026-06-21T12:10:00.000Z'),
  });
  await f.deliver(await f.event(second.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(optedOut)).toEqual([beforeOptedOut]);
  expect(await f.requests(expired)).toEqual([beforeExpired]);
  expect(beforeOptedOut?.['cancel_reason']).toBe('OPTED_OUT');
  expect(beforeExpired?.['cancel_reason']).toBe('PAST_DEADLINE');
});

it('a session after the deadline cancels the request with PAST_DEADLINE', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const first = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-22T12:10:00.000Z'),
  });
  f.clock.at = new Date('2026-06-22T12:30:00.000Z');
  await f.deliver(await f.event(first.sessionId, 'ServiceSessionRecorded'));
  expect((await f.requests(customer))[0]?.['status']).toBe('SCHEDULED');
  f.clock.at = new Date('2026-06-22T19:31:00.000Z');
  const second = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-22T13:00:00.000Z'),
  });
  await f.deliver(await f.event(second.sessionId, 'ServiceSessionRecorded'));
  const row = (await f.requests(customer))[0];
  expect(row?.['status']).toBe('CANCELLED');
  expect(row?.['cancel_reason']).toBe('PAST_DEADLINE');
});

it('a deadline equal to the clock still schedules the request', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-23T12:10:00.000Z'),
  });
  f.clock.at = new Date('2026-06-23T19:30:00.000Z');
  await f.deliver(await f.event(session.sessionId, 'ServiceSessionRecorded'));
  const row = (await f.requests(customer))[0];
  expect(row?.['status']).toBe('SCHEDULED');
  expect(row?.['cancel_reason']).toBeNull();
});

it('a NO_ACTIVE_LINE row whose deadline passed is cancelled with PAST_DEADLINE, not reopened', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const first = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-24T12:10:00.000Z'),
  });
  f.clock.at = new Date('2026-06-24T12:30:00.000Z');
  await f.deliver(await f.event(first.sessionId, 'ServiceSessionRecorded'));
  await f.cancelLine(first.lineId);
  await f.deliver(await f.event(first.sessionId, 'ServiceLineChanged'));
  expect((await f.requests(customer))[0]?.['cancel_reason']).toBe('NO_ACTIVE_LINE');
  f.clock.at = new Date('2026-06-24T19:31:00.000Z');
  const again = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-24T13:00:00.000Z'),
  });
  await f.deliver(await f.event(again.sessionId, 'ServiceSessionRecorded'));
  const row = (await f.requests(customer))[0];
  expect(row?.['status']).toBe('CANCELLED');
  expect(row?.['cancel_reason']).toBe('PAST_DEADLINE');
});

it('an event of another company never writes a row of this company', async () => {
  const foreign = await f.session({
    company: TENANT.B.company,
    occurredAt: new Date('2026-06-25T12:10:00.000Z'),
  });
  await f.deliver(await f.event(foreign.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(ORDER_IDS.customer)).toHaveLength(0);
  const [row] = await f.owner`SELECT count(*)::int AS n FROM rating_requests
    WHERE company_id=${TENANT.B.company}`;
  expect(Number(row?.['n'])).toBe(1);
});

it('two concurrent deliveries of the same customer and day end with one row of the latest session', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const early = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-26T12:10:00.000Z'),
  });
  const late = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-26T14:00:00.000Z'),
  });
  const first = await f.event(early.sessionId, 'ServiceSessionRecorded');
  const second = await f.event(late.sessionId, 'ServiceSessionRecorded');
  await Promise.all([f.deliver(first), f.deliver(second)]);
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['due_at']).toEqual(new Date('2026-06-26T15:00:00.000Z'));
  expect(rows[0]?.['status']).toBe('SCHEDULED');
});
