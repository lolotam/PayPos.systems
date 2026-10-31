import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  everyDay,
  ratingClaimsFixture,
  testTokenHash,
  type RatingClaimsFixture,
} from './rating-claims.fixture.ts';

let f: RatingClaimsFixture;
beforeEach(async () => {
  f = await ratingClaimsFixture();
});
afterEach(async () => {
  await f?.close();
});

const KUWAIT = 'Asia/Kuwait';
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);
const VISIT = new Date('2026-06-01T12:10:00.000Z');
const LATER_VISIT = new Date('2026-06-01T13:00:00.000Z');

async function visit(options: { customerId: string; branchId: string; at?: Date }) {
  const session = await f.session({
    customerId: options.customerId,
    branchId: options.branchId,
    occurredAt: options.at ?? VISIT,
  });
  await f.schedule(session.sessionId);
  return session;
}

it('RT-09 two workers claim the request once and publish one ready event', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await visit({ customerId: customer, branchId });
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await Promise.all([f.claimAll(), f.claimAll()]);
  const row = await f.request(customer);
  expect(row?.['status']).toBe('SENDING');
  expect(row?.['token_hash']).not.toBeNull();
  expect(row?.['token_key_version']).toBe(1);
  expect(await f.readyEvents()).toHaveLength(1);
});

it('RT-10 the attribution is the performers read at the claim', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const other = await f.secondEmployee();
  const first = await visit({ customerId: customer, branchId });
  const second = await visit({ customerId: customer, branchId, at: LATER_VISIT });
  await f.setPerformer(second.lineId, other);
  f.clock.at = new Date('2026-06-01T14:30:00.000Z');
  await f.claimAll();
  const row = await f.request(customer);
  expect(row?.['status']).toBe('SENDING');
  const snapshot = await f.performers(String(row?.['id']));
  expect(snapshot).toHaveLength(2);
  expect(first.sessionId).not.toBe(second.sessionId);
});

it('RT-10 a cancellation before the claim removes a performer from the attribution', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const other = await f.secondEmployee();
  const first = await visit({ customerId: customer, branchId });
  const second = await visit({ customerId: customer, branchId, at: LATER_VISIT });
  await f.setPerformer(second.lineId, other);
  await f.cancelLine(first.lineId);
  f.clock.at = new Date('2026-06-01T14:30:00.000Z');
  await f.claimAll();
  const row = await f.request(customer);
  expect(row?.['status']).toBe('SENDING');
  const snapshot = await f.performers(String(row?.['id']));
  expect(snapshot).toHaveLength(1);
  expect(snapshot[0]?.['employee_id']).toBe(other);
});

it('RT-10 a cancellation after the claim does not remove the performer', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const other = await f.secondEmployee();
  const first = await visit({ customerId: customer, branchId });
  const second = await visit({ customerId: customer, branchId, at: LATER_VISIT });
  await f.setPerformer(second.lineId, other);
  f.clock.at = new Date('2026-06-01T14:30:00.000Z');
  await f.claimAll();
  const row = await f.request(customer);
  const before = await f.performers(String(row?.['id']));
  await f.cancelLine(first.lineId);
  expect(await f.performers(String(row?.['id']))).toEqual(before);
  expect(before).toHaveLength(2);
});

it('RT-11 a cancellation no projection has seen still blocks the send', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const session = await visit({ customerId: customer, branchId });
  await f.cancelLine(session.lineId);
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await f.claimAll();
  const row = await f.request(customer);
  expect(row?.['status']).toBe('CANCELLED');
  expect(row?.['cancel_reason']).toBe('NO_ACTIVE_LINE');
  expect(await f.readyEvents()).toHaveLength(0);
});

it('RT-12 and RT-14 the phone travels only in the event and no token is stored anywhere', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await visit({ customerId: customer, branchId });
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await f.claimAll();
  const row = await f.request(customer);
  const events = await f.readyEvents();
  expect(events).toHaveLength(1);
  const payload = events[0]?.['payload'] as {
    notification_recipients: { phone: string }[];
    rating_request_id: string;
  };
  expect(payload.notification_recipients[0]?.phone).toMatch(/^\+9999999\d{5}$/);
  expect(payload.rating_request_id).toBe(row?.['id']);
  expect(Object.keys(payload)).not.toContain('token');
  expect(JSON.stringify(payload)).not.toMatch(/https?:/);
  expect(JSON.stringify(payload)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  const hash = row?.['token_hash'] as Buffer | null;
  expect(hash?.length).toBe(32);
});

it('RT-13 the opt-out committed first cancels the request', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await visit({ customerId: customer, branchId });
  await f.optOut(customer);
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await f.claimAll();
  const row = await f.request(customer);
  expect(row?.['status']).toBe('CANCELLED');
  expect(row?.['cancel_reason']).toBe('OPTED_OUT');
  expect(await f.readyEvents()).toHaveLength(0);
});

it('RT-13 the claim committed first still delivers that one request', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await visit({ customerId: customer, branchId });
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await f.claimAll();
  await f.optOut(customer);
  const row = await f.request(customer);
  expect(row?.['status']).toBe('SENDING');
  expect(await f.readyEvents()).toHaveLength(1);
});

it('RT-14b a rotated key stores the new version and the first request keeps the old one', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const firstCustomer = await f.customer();
  await visit({ customerId: firstCustomer, branchId });
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await f.claimAll();
  const first = await f.request(firstCustomer);
  expect(first?.['token_key_version']).toBe(1);
  f.token.version = 2;
  const secondCustomer = await f.customer();
  await visit({ customerId: secondCustomer, branchId });
  await f.claimAll();
  const second = await f.request(secondCustomer);
  expect(second?.['token_key_version']).toBe(2);
  expect(first?.['token_key_version']).toBe(1);
  expect(Buffer.from(first?.['token_hash'] as Buffer).toString('hex')).toBe(
    Buffer.from(testTokenHash(String(first?.['id']))).toString('hex'),
  );
  expect(Buffer.from(second?.['token_hash'] as Buffer).toString('hex')).toBe(
    Buffer.from(testTokenHash(String(second?.['id']))).toString('hex'),
  );
});

it('RT-01b every request snapshots only the performers of its own day', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  const other = await f.secondEmployee();
  const first = await visit({ customerId: customer, branchId });
  const secondDay = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-02T12:10:00.000Z'),
  });
  await f.schedule(secondDay.sessionId);
  await f.setPerformer(secondDay.lineId, other);
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await f.claimAll();
  const rows = await f.owner`SELECT id, business_date::text AS day FROM rating_requests
    WHERE company_id = ${f.company} AND customer_id = ${customer} ORDER BY business_date`;
  expect(rows).toHaveLength(2);
  const firstDay = rows[0];
  if (firstDay === undefined) throw new Error('REQUESTS_MISSING');
  const firstSnapshot = await f.performers(String(firstDay['id']));
  expect(firstSnapshot).toHaveLength(1);
  expect(firstSnapshot[0]?.['employee_id']).not.toBe(other);
  f.clock.at = new Date('2026-06-02T13:30:00.000Z');
  await f.claimAll();
  const secondDayRow = rows[1];
  if (secondDayRow === undefined) throw new Error('REQUESTS_MISSING');
  const secondSnapshot = await f.performers(String(secondDayRow['id']));
  expect(secondSnapshot).toHaveLength(1);
  expect(secondSnapshot[0]?.['employee_id']).toBe(other);
  expect(await f.performers(String(firstDay['id']))).toEqual(firstSnapshot);
  expect(first.sessionId).not.toBe(secondDay.sessionId);
});

it('RT-07 the switch turned off after the scheduling cancels the request', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await visit({ customerId: customer, branchId });
  f.enabled.on = false;
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await f.claimAll();
  f.enabled.on = true;
  const row = await f.request(customer);
  expect(row?.['status']).toBe('CANCELLED');
  expect(row?.['cancel_reason']).toBe('REQUESTS_OFF');
  expect(await f.readyEvents()).toHaveLength(0);
});

it('a request scheduled before the deploy is claimed with no new visit event', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await visit({ customerId: customer, branchId });
  f.clock.at = new Date('2026-06-01T13:30:00.000Z');
  await f.claimAll();
  const row = await f.request(customer);
  expect(row?.['status']).toBe('SENDING');
  expect(await f.readyEvents()).toHaveLength(1);
});

it('a newer visit moves the due time and the claim reschedules instead of claiming', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await visit({ customerId: customer, branchId });
  await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-01T13:40:00.000Z'),
  });
  f.clock.at = new Date('2026-06-01T13:45:00.000Z');
  await f.claimAll();
  const row = await f.request(customer);
  expect(row?.['status']).toBe('SCHEDULED');
  expect(row?.['due_at']).toEqual(new Date('2026-06-01T14:40:00.000Z'));
  expect(await f.readyEvents()).toHaveLength(0);
  f.clock.at = new Date('2026-06-01T14:50:00.000Z');
  await f.claimAll();
  const claimed = await f.request(customer);
  expect(claimed?.['status']).toBe('SENDING');
  expect(await f.readyEvents()).toHaveLength(1);
});
