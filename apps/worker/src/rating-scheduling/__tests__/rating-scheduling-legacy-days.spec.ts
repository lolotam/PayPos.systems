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
const OVERNIGHT = everyDay([{ opens: '18:00', closes: '02:00' }]);
const DAYTIME_2359 = everyDay([{ opens: '10:00', closes: '23:59' }]);

async function markSent(
  customer: string,
  claimedAt: Date,
  sentAt: Date,
  tokenHex: string,
): Promise<void> {
  const expiresAt = new Date(claimedAt.getTime() + 7 * 86_400_000);
  await f.owner.begin(async (sqlTx) => {
    await sqlTx`UPDATE rating_requests SET
        status = 'SENDING',
        token_hash = decode(repeat(${tokenHex}, 32), 'hex'),
        token_key_version = 1,
        claimed_at = ${claimedAt},
        expires_at = ${expiresAt},
        ready_event_id = ${f.ids.newId()}
      WHERE company_id = ${f.tenant.company} AND customer_id = ${customer}`;
    await sqlTx`UPDATE rating_requests SET status = 'SENT', sent_at = ${sentAt}
      WHERE company_id = ${f.tenant.company} AND customer_id = ${customer}`;
  });
}

it('PP-286 T-3 does not absorb a new 00:15 visit into yesterday SENT overnight request after overnight hours are removed', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: OVERNIGHT });
  const customer = await f.customer();
  const eveningVisit = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T17:00:00.000Z'),
  });
  f.clock.at = new Date('2026-06-14T17:05:00.000Z');
  await f.deliver(await f.event(eveningVisit.sessionId, 'ServiceSessionRecorded'));
  await markSent(
    customer,
    new Date('2026-06-14T18:00:00.000Z'),
    new Date('2026-06-14T18:01:00.000Z'),
    'ef',
  );
  await f.setHours(branchId, DAYTIME_2359, KUWAIT);

  const newVisit0015 = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T21:15:00.000Z'),
  });
  f.clock.at = new Date('2026-06-14T21:16:00.000Z');
  await f.deliver(await f.event(newVisit0015.sessionId, 'ServiceSessionRecorded'));

  const rows = await f.requests(customer);
  expect(rows.map((row) => [row['day'], row['status']])).toEqual([
    ['2026-06-14', 'SENT'],
    ['2026-06-15', 'SCHEDULED'],
  ]);
  const storedNew =
    await f.owner`SELECT rating_request_day::text AS day FROM service_sessions WHERE id=${newVisit0015.sessionId}`;
  expect(storedNew[0]?.['day']).toBe('2026-06-15');
});

async function setupSentOvernight0200(branchId: string, tokenHex: string): Promise<string> {
  const customer = await f.customer();
  await f.setHours(branchId, OVERNIGHT, KUWAIT);
  const early0115 = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T22:15:00.000Z'),
  });
  f.clock.at = new Date('2026-06-14T22:16:00.000Z');
  await f.deliver(await f.event(early0115.sessionId, 'ServiceSessionRecorded'));
  await markSent(
    customer,
    new Date('2026-06-14T23:00:00.000Z'),
    new Date('2026-06-14T23:01:00.000Z'),
    tokenHex,
  );
  await f.setHours(branchId, DAYTIME_2359, KUWAIT);
  return customer;
}

it('PP-286 T-3 rejects a post-claim late-recorded 01:50 visit on live event when earlier 01:15 pushed due_at to 02:00', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: OVERNIGHT });
  const customer = await setupSentOvernight0200(branchId, 'de');
  const livePostClaim = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T22:50:00.000Z'),
    recordedAt: new Date('2026-06-14T23:05:00.000Z'),
  });
  f.clock.at = new Date('2026-06-14T23:06:00.000Z');
  await f.deliver(await f.event(livePostClaim.sessionId, 'ServiceSessionRecorded'));

  const stored =
    await f.owner`SELECT rating_request_day::text AS day FROM service_sessions WHERE id=${livePostClaim.sessionId}`;
  expect(stored[0]?.['day']).toBe('2026-06-15');
  expect((await f.requests(customer)).map((row) => [row['day'], row['status']])).toEqual([
    ['2026-06-14', 'SENT'],
    ['2026-06-15', 'SCHEDULED'],
  ]);
});

it('PP-286 T-3 rejects a post-claim late-recorded 01:50 visit on bootstrap when earlier 01:15 pushed due_at to 02:00', async () => {
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: OVERNIGHT });
  const customer = await setupSentOvernight0200(branchId, 'bc');
  const bootPostClaim = await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date('2026-06-14T22:50:00.000Z'),
    recordedAt: new Date('2026-06-14T23:05:00.000Z'),
  });
  f.clock.at = new Date('2026-06-14T23:06:00.000Z');
  await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: new Date('2026-06-14T00:00:00.000Z'),
  });

  const stored =
    await f.owner`SELECT rating_request_day::text AS day FROM service_sessions WHERE id=${bootPostClaim.sessionId}`;
  expect(stored[0]?.['day']).toBe('2026-06-15');
  expect((await f.requests(customer)).map((row) => [row['day'], row['status']])).toEqual([
    ['2026-06-14', 'SENT'],
    ['2026-06-15', 'SCHEDULED'],
  ]);
});

it('PP-286 T-3: keeps RT-01b Dubai 00:10 daytime visit separate from Kuwait 23:30 overnight request', async () => {
  const kuwaitBranch = await f.branch({ timezone: KUWAIT, openingHours: OVERNIGHT });
  const dubaiBranch = await f.branch({ timezone: 'Asia/Dubai', openingHours: DAYTIME_2359 });
  const customer = await f.customer();
  const kuwaitVisit = await f.session({
    customerId: customer,
    branchId: kuwaitBranch,
    occurredAt: new Date('2026-06-14T20:30:00.000Z'),
  });
  const dubaiVisit = await f.session({
    customerId: customer,
    branchId: dubaiBranch,
    occurredAt: new Date('2026-06-14T20:10:00.000Z'),
  });
  f.clock.at = new Date('2026-06-14T20:35:00.000Z');
  await f.deliver(await f.event(kuwaitVisit.sessionId, 'ServiceSessionRecorded'));
  await f.deliver(await f.event(dubaiVisit.sessionId, 'ServiceSessionRecorded'));

  expect((await f.requests(customer)).map((row) => [row['day'], row['branch_id']])).toEqual([
    ['2026-06-14', kuwaitBranch],
    ['2026-06-15', dubaiBranch],
  ]);
});
