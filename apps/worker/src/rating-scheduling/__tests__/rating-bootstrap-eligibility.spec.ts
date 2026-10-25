import { afterAll, beforeAll, expect, it } from 'vitest';
import { daySessionsReader } from '../../modules/orders/index.ts';
import {
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

const HOUR = 3_600_000;
const start = new Date('2027-02-03T12:00:00Z');
const cutoff = new Date(start.getTime() - 48 * HOUR);

async function visits() {
  const branchId = await f.branch({ timezone: 'Asia/Kuwait', openingHours: null });
  const customerId = await f.customer();
  const old = await f.session({
    customerId,
    branchId,
    occurredAt: new Date(start.getTime() - 49 * HOUR),
  });
  const recent = await f.session({
    customerId,
    branchId,
    occurredAt: new Date(start.getTime() - 47 * HOUR),
  });
  await f.cancelLine(recent.lineId);
  f.clock.at = start;
  return { customerId, old, recent };
}

function bootstrap() {
  return f.bootstrap(() => undefined)({ companyId: f.tenant.company, cutoff });
}

it('does not create an old deadline-free request through a cancelled in-range visit; live delivery still can', async () => {
  const { customerId, old } = await visits();
  expect((await bootstrap()).complete).toBe(true);
  expect(await f.requests(customerId)).toHaveLength(0);
  await f.deliver(await f.event(old.sessionId, 'ServiceSessionRecorded'));
  expect(await f.requests(customerId)).toMatchObject([
    { status: 'SCHEDULED', send_deadline: null },
  ]);
});

it('preserves a live request with an active old visit outside the bootstrap window', async () => {
  const { customerId, old } = await visits();
  await f.deliver(await f.event(old.sessionId, 'ServiceSessionRecorded'));
  const before = await f.requests(customerId);
  await bootstrap();
  expect(await f.requests(customerId)).toEqual(before);
});

it('still cancels a prior request when the authoritative day has no active visit', async () => {
  const { customerId, old } = await visits();
  await f.deliver(await f.event(old.sessionId, 'ServiceSessionRecorded'));
  await f.cancelLine(old.lineId);
  await bootstrap();
  expect(await f.requests(customerId)).toMatchObject([
    { status: 'CANCELLED', cancel_reason: 'NO_ACTIVE_LINE' },
  ]);
});

it('does not reopen a cancelled row solely for an old deadline-free active visit', async () => {
  const { customerId, old } = await visits();
  await f.deliver(await f.event(old.sessionId, 'ServiceSessionRecorded'));
  await f.owner`UPDATE rating_requests SET status='CANCELLED', cancel_reason='NO_ACTIVE_LINE'
    WHERE company_id=${f.tenant.company} AND customer_id=${customerId}`;
  await bootstrap();
  expect(await f.requests(customerId)).toMatchObject([
    { status: 'CANCELLED', cancel_reason: 'NO_ACTIVE_LINE' },
  ]);
  await f.deliver(await f.event(old.sessionId, 'ServiceSessionLinesAdded'));
  expect(await f.requests(customerId)).toMatchObject([
    { status: 'SCHEDULED', cancel_reason: null },
  ]);
});

it('prints the same final count fields when the watermark is empty', async () => {
  const logs: string[] = [];
  const result = await f.bootstrap((line) => logs.push(line), {
    ...daySessionsReader,
    watermark: async () => null,
  })({ companyId: f.tenant.company, cutoff });
  expect(result).toMatchObject({ expected: 0, processed: 0, alreadyDone: 0, complete: true });
  expect(logs.at(-1)).toBe('processed=0 alreadyDone=0 expected=0 verifiedExpected=0 complete=true');
});
