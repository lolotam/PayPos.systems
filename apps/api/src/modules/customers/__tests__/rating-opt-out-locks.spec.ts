import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { waitForBlockedAppSession } from '../../../../../../packages/db/test/rating-concurrency-fixtures.ts';
import {
  RATING_TENANT,
  seedRatingTenants,
  type RatingTenant,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { seedRatingLink } from '../../../../test/rating-link.fixture.ts';

const ENDPOINT = '/v1/ratings/opt-out';
const BEFORE_EXPIRY = new Date('2026-06-02T00:00:00Z');
const AFTER_EXPIRY = new Date('2026-06-09T00:00:00Z');

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

let now = BEFORE_EXPIRY;
let phones = 0;
let generous: Harness;
let bounded: Harness;

beforeAll(async () => {
  generous = await startHarness({
    customersClock: { now: () => now },
    customersTransactionTimeoutMs: 10_000,
  });
  await seedRatingTenants(generous.ownerUrl);
  bounded = await startHarness({
    customersClock: { now: () => now },
    customersTransactionTimeoutMs: 300,
  });
  await seedRatingTenants(bounded.ownerUrl);
});
afterAll(async () => {
  await generous.close();
  await bounded.close();
});

async function linkFor(harness: Harness) {
  phones += 1;
  const customer = randomUUID();
  const phone = `+1888${String(phones).padStart(7, '0')}`;
  await harness.owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${RATING_TENANT.A.company}, ${customer}, 'Synthetic customer', ${phone}, 'ar', now(), now())`;
  const tenant: RatingTenant = { ...RATING_TENANT.A, customer };
  const link = await seedRatingLink(harness.owner, { tenant });
  return { ...link, customer };
}

function post(harness: Harness, token: string) {
  return harness.send('POST', ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: token },
  });
}

async function customerOptOutAt(harness: Harness, customerId: string): Promise<Date | null> {
  const [row] = await harness.owner`SELECT opted_out_at FROM customers
    WHERE company_id=${RATING_TENANT.A.company} AND id=${customerId}`;
  const value = row?.['opted_out_at'];
  return value === null || value === undefined ? null : (value as Date);
}

async function optOutAudits(harness: Harness, customerId: string): Promise<readonly unknown[]> {
  return harness.owner`SELECT action FROM audit_log
    WHERE company_id=${RATING_TENANT.A.company} AND entity='customer' AND entity_id=${customerId}
      AND action='rating_opted_out'`;
}

/**
 * Runs the request while another connection holds the customer row, and moves the clock past the
 * link's expiry before the lock is released.
 */
async function requestBehindTheLock(
  harness: Harness,
  link: { readonly companyId: string; readonly customer: string; readonly token: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Promise<{ status: number; body: Record<string, unknown> }> | undefined;
  const locker = postgres(harness.ownerUrl, { max: 1, onnotice: () => undefined });
  let failure: unknown;
  try {
    await locker.begin(async (tx) => {
      await tx`SELECT id FROM customers WHERE company_id=${link.companyId} AND id=${link.customer}
        FOR NO KEY UPDATE`;
      response = post(harness, link.token);
      await waitForBlockedAppSession(harness.owner);
      now = AFTER_EXPIRY;
    });
  } catch (error) {
    failure = error;
  }
  try {
    const result = await response;
    if (failure !== undefined) throw failure;
    if (result === undefined) throw new Error('THE_REQUEST_NEVER_STARTED');
    return result;
  } finally {
    await locker.end();
  }
}

it('refuses a link that expired while the customer row was locked', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(generous);
  const response = await requestBehindTheLock(generous, link);
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('RATING_LINK_UNAVAILABLE');
  expect(await customerOptOutAt(generous, link.customer)).toBeNull();
  expect(await optOutAudits(generous, link.customer)).toHaveLength(0);
});

it('refuses an expired link even when the customer already opted out', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(generous);
  await generous.owner`UPDATE customers
    SET opted_out_at=${BEFORE_EXPIRY.toISOString()}::timestamptz,
      updated_at=${BEFORE_EXPIRY.toISOString()}::timestamptz
    WHERE company_id=${link.companyId} AND id=${link.customer}`;
  const response = await requestBehindTheLock(generous, link);
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('RATING_LINK_UNAVAILABLE');
});

it('answers 503 when the lock takes longer than the transaction allows', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(bounded);
  let response: Promise<{ status: number; body: Record<string, unknown> }> | undefined;
  await bounded.owner.begin(async (tx) => {
    await tx`SELECT id FROM customers WHERE company_id=${link.companyId} AND id=${link.customer}
      FOR NO KEY UPDATE`;
    response = post(bounded, link.token);
    await delay(900);
  });
  const result = await response;
  if (result === undefined) throw new Error('THE_REQUEST_NEVER_STARTED');
  expect(result.status).toBe(503);
  expect(result.body['code']).toBe('NOT_READY');
  expect(await customerOptOutAt(bounded, link.customer)).toBeNull();
});

it('answers 404 for an already-expired link while the customer lock is still held', async () => {
  now = AFTER_EXPIRY;
  const link = await linkFor(generous);
  await generous.owner.begin(async (tx) => {
    await tx`SELECT id FROM customers WHERE company_id=${link.companyId} AND id=${link.customer}
      FOR NO KEY UPDATE`;
    const response = await post(generous, link.token);
    expect(response.status).toBe(404);
    expect(response.body['code']).toBe('RATING_LINK_UNAVAILABLE');
  });
  expect(await customerOptOutAt(generous, link.customer)).toBeNull();
  expect(await optOutAudits(generous, link.customer)).toHaveLength(0);
});

it('serializes concurrent duplicate opt-outs into one write and one audit row', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(generous);
  const locker = postgres(generous.ownerUrl, { max: 1, onnotice: () => undefined });
  let first: ReturnType<typeof post> | undefined;
  let second: ReturnType<typeof post> | undefined;
  let failure: unknown;
  try {
    try {
      await locker.begin(async (tx) => {
        await tx`SELECT id FROM customers WHERE company_id=${link.companyId} AND id=${link.customer}
          FOR NO KEY UPDATE`;
        first = post(generous, link.token);
        second = post(generous, link.token);
        await waitForBlockedAppSession(generous.owner);
      });
    } catch (error) {
      failure = error;
    }
    if (first === undefined || second === undefined) throw new Error('THE_REQUESTS_NEVER_STARTED');
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    if (failure !== undefined) throw failure;
    expect(firstResponse.status).toBe(204);
    expect(secondResponse.status).toBe(204);
  } finally {
    await locker.end();
  }
  expect(await customerOptOutAt(generous, link.customer)).toEqual(BEFORE_EXPIRY);
  expect(await optOutAudits(generous, link.customer)).toHaveLength(1);
});

it('does not block on a customer key-share lock or a rating-request update lock', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(generous);
  await generous.owner.begin(async (tx) => {
    await tx`SELECT id FROM customers WHERE company_id=${link.companyId} AND id=${link.customer}
      FOR KEY SHARE`;
    await tx`SELECT id FROM rating_requests WHERE company_id=${link.companyId} AND id=${link.requestId}
      FOR UPDATE`;
    const response = await post(generous, link.token);
    expect(response.status).toBe(204);
  });
  expect(await customerOptOutAt(generous, link.customer)).not.toBeNull();
});
