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
const TEN_TO_TEN = everyDay([{ opens: '10:00', closes: '22:00' }]);
const HOUR = 3_600_000;

function startOf(day: string): Date {
  return new Date(`${day}T12:00:00.000Z`);
}

function checkpointOf(line: string): string {
  return /checkpoint=([0-9a-f-]{36})/.exec(line)?.[1] ?? '';
}

function rangeOf(line: string): { cutoff: Date; maxSessionId: string; recordedAtOrBefore: Date } {
  return {
    cutoff: new Date(/cutoff=([^ ]+)/.exec(line)?.[1] ?? ''),
    maxSessionId: /maxSessionId=([^ ]+)/.exec(line)?.[1] ?? '',
    recordedAtOrBefore: new Date(/recordedAtOrBefore=([^ ]+)/.exec(line)?.[1] ?? ''),
  };
}

it('FR-B02b ten recent sessions of ten customers are scheduled in pages of three', async () => {
  const start = startOf('2026-12-01');
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customers: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const customer = await f.customer();
    customers.push(customer);
    await f.session({
      customerId: customer,
      branchId,
      occurredAt: new Date(start.getTime() - HOUR),
    });
  }
  f.clock.at = start;
  const logs: string[] = [];
  const result = await f.bootstrap((line) => logs.push(line))({
    companyId: f.tenant.company,
    cutoff: new Date(start.getTime() - 48 * HOUR),
    pageSize: 3,
  });
  expect(result.processed).toBe(10);
  expect(result.expected).toBe(10);
  expect(result.complete).toBe(true);
  expect(logs.filter((line) => line.startsWith('checkpoint='))).toHaveLength(4);
  for (const customer of customers) expect(await f.requests(customer)).toHaveLength(1);
});

it('FR-B02b a restart from the checkpoint of the second page processes only the rest', async () => {
  const start = startOf('2026-12-05');
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  for (let index = 0; index < 10; index += 1) {
    await f.session({
      customerId: await f.customer(),
      branchId,
      occurredAt: new Date(start.getTime() - HOUR),
    });
  }
  f.clock.at = start;
  const logs: string[] = [];
  const first = await f.bootstrap((line) => logs.push(line))({
    companyId: f.tenant.company,
    cutoff: new Date(start.getTime() - 48 * HOUR),
    pageSize: 3,
  });
  expect(first.processed).toBe(10);
  const range = rangeOf(logs[0] ?? '');
  const restart = await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: range.cutoff,
    maxSessionId: range.maxSessionId,
    recordedAtOrBefore: range.recordedAtOrBefore,
    checkpoint: checkpointOf(logs[2] ?? ''),
  });
  expect(restart.processed).toBe(4);
  expect(restart.alreadyDone).toBe(6);
  expect(restart.expected).toBe(10);
  expect(restart.alreadyDone + restart.processed).toBe(restart.expected);
  expect(restart.complete).toBe(true);
});

it('FR-B02b a session recorded after the start or above the frozen bound is outside the range', async () => {
  const start = startOf('2026-12-09');
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const inside = await f.customer();
  await f.session({
    customerId: inside,
    branchId,
    occurredAt: new Date(start.getTime() - HOUR),
  });
  const late = await f.customer();
  await f.session({
    customerId: late,
    branchId,
    occurredAt: new Date(start.getTime() + HOUR),
    recordedAt: new Date(start.getTime() + HOUR),
  });
  f.clock.at = start;
  const logs: string[] = [];
  const first = await f.bootstrap((line) => logs.push(line))({
    companyId: f.tenant.company,
    cutoff: new Date(start.getTime() - 48 * HOUR),
    pageSize: 3,
  });
  expect(first.expected).toBe(1);
  expect(first.processed).toBe(1);
  expect(await f.requests(late)).toHaveLength(0);
  const after = await f.customer();
  await f.session({
    customerId: after,
    branchId,
    occurredAt: new Date(start.getTime() - HOUR),
  });
  const range = rangeOf(logs[0] ?? '');
  const second = await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: range.cutoff,
    maxSessionId: range.maxSessionId,
    recordedAtOrBefore: range.recordedAtOrBefore,
  });
  expect(second.expected).toBe(1);
  expect(second.processed).toBe(0);
  expect(await f.requests(after)).toHaveLength(0);
});

it('FR-B02b a no-hours branch is rated inside the 48 hours and left out before it', async () => {
  const start = startOf('2026-12-13');
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: null });
  const inside = await f.customer();
  await f.session({
    customerId: inside,
    branchId,
    occurredAt: new Date(start.getTime() - 47 * HOUR),
  });
  const outside = await f.customer();
  await f.session({
    customerId: outside,
    branchId,
    occurredAt: new Date(start.getTime() - 49 * HOUR),
  });
  f.clock.at = start;
  const result = await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: new Date(start.getTime() - 48 * HOUR),
    pageSize: 3,
  });
  expect(result.expected).toBe(1);
  expect(result.processed).toBe(1);
  const rows = await f.requests(inside);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['send_deadline']).toBeNull();
  expect(await f.requests(outside)).toHaveLength(0);
});

it('FR-B02b a visit whose deadline passed is cancelled with PAST_DEADLINE and never sent', async () => {
  const start = startOf('2026-12-17');
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date(start.getTime() - 24 * HOUR),
  });
  f.clock.at = start;
  const result = await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: new Date(start.getTime() - 48 * HOUR),
    pageSize: 3,
  });
  expect(result.processed).toBe(1);
  const rows = await f.requests(customer);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['status']).toBe('CANCELLED');
  expect(rows[0]?.['cancel_reason']).toBe('PAST_DEADLINE');
});

it('FR-B02b the live event first and the bootstrap first give one row of the latest session', async () => {
  const start = startOf('2026-12-21');
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const liveFirst = await f.customer();
  const early = await f.session({
    customerId: liveFirst,
    branchId,
    occurredAt: new Date(start.getTime() - 2 * HOUR),
  });
  await f.session({
    customerId: liveFirst,
    branchId,
    occurredAt: new Date(start.getTime() - HOUR),
  });
  f.clock.at = start;
  await f.deliver(await f.event(early.sessionId, 'ServiceSessionRecorded'));
  await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: new Date(start.getTime() - 48 * HOUR),
    pageSize: 3,
  });
  const liveRows = await f.requests(liveFirst);
  expect(liveRows).toHaveLength(1);
  expect(liveRows[0]?.['due_at']).toEqual(start);

  const bootstrapFirst = await f.customer();
  await f.session({
    customerId: bootstrapFirst,
    branchId,
    occurredAt: new Date(start.getTime() - 2 * HOUR),
  });
  const second = await f.session({
    customerId: bootstrapFirst,
    branchId,
    occurredAt: new Date(start.getTime() - HOUR),
  });
  await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: new Date(start.getTime() - 48 * HOUR),
    pageSize: 3,
  });
  await f.deliver(await f.event(second.sessionId, 'ServiceSessionRecorded'));
  const bootstrapRows = await f.requests(bootstrapFirst);
  expect(bootstrapRows).toHaveLength(1);
  expect(bootstrapRows[0]?.['due_at']).toEqual(start);
});

it('FR-B02b with the switch off the job schedules nothing', async () => {
  const start = startOf('2026-12-25');
  const branchId = await f.branch({ timezone: KUWAIT, openingHours: TEN_TO_TEN });
  const customer = await f.customer();
  await f.session({
    customerId: customer,
    branchId,
    occurredAt: new Date(start.getTime() - HOUR),
  });
  f.clock.at = start;
  f.enabled.on = false;
  const result = await f.bootstrap(() => undefined)({
    companyId: f.tenant.company,
    cutoff: new Date(start.getTime() - 48 * HOUR),
    pageSize: 3,
  });
  expect(result.processed).toBe(1);
  expect(await f.requests(customer)).toHaveLength(0);
  f.enabled.on = true;
});
