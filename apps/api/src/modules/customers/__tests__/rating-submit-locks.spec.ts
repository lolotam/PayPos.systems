import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import { createDatabase } from '@pospay/db';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { waitForBlockedAppSession } from '../../../../../../packages/db/test/rating-concurrency-fixtures.ts';
import {
  claimRequest,
  insertRequest,
  RATING_TENANT,
  seedRatingTenants,
  type RatingTenant,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { ratingTokenDigest, seedRatingLink } from '../../../../test/rating-link.fixture.ts';

const SUBMIT_ENDPOINT = '/v1/ratings/submit';
const VIEW_ENDPOINT = '/v1/ratings/view';
const CLAIMED_AT = new Date('2026-06-01T00:00:00Z');
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
  const base = RATING_TENANT.A;
  const customer = randomUUID();
  const phone = `+1888${String(phones).padStart(7, '0')}`;
  await harness.owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${base.company}, ${customer}, 'Synthetic customer', ${phone}, 'ar', now(), now())`;
  const tenant: RatingTenant = { ...base, customer };
  const link = await seedRatingLink(harness.owner, { tenant });
  return { ...link, customer };
}

function submit(harness: Harness, token: string) {
  return harness.send('POST', SUBMIT_ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: token },
    body: { stars: 5 },
  });
}

function view(harness: Harness, token: string) {
  return harness.send('GET', VIEW_ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: token },
  });
}

async function consumedAt(
  harness: Harness,
  companyId: string,
  requestId: string,
): Promise<Date | null> {
  const [row] = await harness.owner`SELECT consumed_at FROM rating_requests
    WHERE company_id=${companyId} AND id=${requestId}`;
  const value = row?.['consumed_at'];
  return value === null || value === undefined ? null : (value as Date);
}

async function ratingsFor(
  harness: Harness,
  companyId: string,
  requestId: string,
): Promise<readonly unknown[]> {
  return harness.owner`SELECT id FROM ratings
    WHERE company_id=${companyId} AND request_id=${requestId}`;
}

/** A claimed request in another tenant, carrying the same token hash. */
async function claimedRequest(
  harness: Harness,
  tenantKey: 'A' | 'B',
  tokenHash: Buffer,
): Promise<string> {
  const base = RATING_TENANT[tenantKey];
  const database = createDatabase({ url: harness.urls.app, ids: { newId: randomUUID } });
  try {
    return await database.withTenant(base.company, async (tx) => {
      const id = await insertRequest(tx, { tenant: base });
      await claimRequest(tx, {
        tenant: base,
        requestId: id,
        tokenHash,
        readyEventId: randomUUID(),
        now: CLAIMED_AT,
        performers: [],
      });
      return id;
    });
  } finally {
    await database.close();
  }
}

it('rolls the consumption back when the rating cannot be stored, and takes the retry', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(generous);
  await generous.owner`ALTER TABLE ratings ADD CONSTRAINT zz_rating_submit_fails CHECK (stars > 100)`;
  let failed: { status: number; body: Record<string, unknown> } | undefined;
  try {
    failed = await submit(generous, link.token);
  } finally {
    await generous.owner`ALTER TABLE ratings DROP CONSTRAINT zz_rating_submit_fails`;
  }
  expect(failed?.status).toBe(500);
  expect(await ratingsFor(generous, link.companyId, link.requestId)).toHaveLength(0);
  expect(await consumedAt(generous, link.companyId, link.requestId)).toBeNull();

  const retry = await submit(generous, link.token);
  expect(retry.status).toBe(204);
  expect(await ratingsFor(generous, link.companyId, link.requestId)).toHaveLength(1);
});

it('refuses a link that expired while the request row was locked', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(generous);
  let response: Promise<{ status: number; body: Record<string, unknown> }> | undefined;
  const locker = postgres(generous.ownerUrl, { max: 1, onnotice: () => undefined });
  try {
    await locker.begin(async (tx) => {
      await tx`SELECT id FROM rating_requests
        WHERE company_id=${link.companyId} AND id=${link.requestId} FOR UPDATE`;
      response = submit(generous, link.token);
      await waitForBlockedAppSession(generous.owner);
      now = AFTER_EXPIRY;
    });
  } finally {
    await locker.end();
  }
  const result = await response;
  if (result === undefined) throw new Error('THE_REQUEST_NEVER_STARTED');
  expect(result.status).toBe(404);
  expect(result.body['code']).toBe('RATING_LINK_UNAVAILABLE');
  expect(await consumedAt(generous, link.companyId, link.requestId)).toBeNull();
  expect(await ratingsFor(generous, link.companyId, link.requestId)).toHaveLength(0);
});

it('answers 503 when the lock takes longer than the transaction allows', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(bounded);
  let response: Promise<{ status: number; body: Record<string, unknown> }> | undefined;
  await bounded.owner.begin(async (tx) => {
    await tx`SELECT id FROM rating_requests
      WHERE company_id=${link.companyId} AND id=${link.requestId} FOR UPDATE`;
    response = submit(bounded, link.token);
    await delay(900);
  });
  const result = await response;
  if (result === undefined) throw new Error('THE_REQUEST_NEVER_STARTED');
  expect(result.status).toBe(503);
  expect(result.body['code']).toBe('NOT_READY');
  expect(await consumedAt(bounded, link.companyId, link.requestId)).toBeNull();
  expect(await ratingsFor(bounded, link.companyId, link.requestId)).toHaveLength(0);
});

it('changes only the tenant the token points at when another holds the same part', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(generous);
  const other = await claimedRequest(generous, 'B', ratingTokenDigest(link.token));

  const viewed = await view(generous, link.token);
  expect(viewed.status).toBe(200);
  expect(viewed.body['business_name']).toBe('Business A');

  const submitted = await submit(generous, link.token);
  expect(submitted.status).toBe(204);

  expect(await consumedAt(generous, link.companyId, link.requestId)).not.toBeNull();
  expect(await ratingsFor(generous, link.companyId, link.requestId)).toHaveLength(1);
  expect(await consumedAt(generous, RATING_TENANT.B.company, other)).toBeNull();
  expect(await ratingsFor(generous, RATING_TENANT.B.company, other)).toHaveLength(0);
});
