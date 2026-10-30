import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import { createDatabase } from '@pospay/db';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  consumeAndRate,
  OTHER_RATING_BUSINESS,
  RATING_TENANT,
  seedRatingTenants,
  type RatingTenant,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { ratingTokenDigest, seedRatingLink } from '../../../../test/rating-link.fixture.ts';

const ENDPOINT = '/v1/ratings/opt-out';
const BEFORE_EXPIRY = new Date('2026-06-02T00:00:00Z');
const LATER = new Date('2026-06-03T00:00:00Z');

let h: Harness;
let now = BEFORE_EXPIRY;
let phones = 0;

beforeAll(async () => {
  h = await startHarness({ customersClock: { now: () => now } });
  await seedRatingTenants(h.ownerUrl);
});
afterAll(async () => {
  await h.close();
});

async function newCustomer(companyId: string): Promise<string> {
  phones += 1;
  const id = randomUUID();
  const phone = `+1777${String(phones).padStart(7, '0')}`;
  await h.owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${companyId}, ${id}, 'Synthetic customer', ${phone}, 'ar', now(), now())`;
  return id;
}

function post(token: string) {
  return h.send('POST', ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: token },
  });
}

async function customerOptOutAt(companyId: string, customerId: string): Promise<Date | null> {
  const [row] = await h.owner`SELECT opted_out_at FROM customers
    WHERE company_id=${companyId} AND id=${customerId}`;
  const value = row?.['opted_out_at'];
  return value === null || value === undefined ? null : (value as Date);
}

async function optOutAudits(companyId: string, customerId: string): Promise<readonly unknown[]> {
  return h.owner`SELECT action FROM audit_log
    WHERE company_id=${companyId} AND entity='customer' AND entity_id=${customerId}
      AND action='rating_opted_out'`;
}

async function linkFor(companyId: string) {
  const customer = await newCustomer(companyId);
  const tenant: RatingTenant = { ...RATING_TENANT.A, customer };
  const link = await seedRatingLink(h.owner, { tenant });
  return { ...link, customer };
}

type CustomerLink = Awaited<ReturnType<typeof linkFor>>;

async function consume(link: CustomerLink): Promise<void> {
  const db = createDatabase({ url: h.urls.app, ids: { newId: randomUUID } });
  try {
    await db.withTenant(link.companyId, async (tx) => {
      const ratingId = await consumeAndRate(tx, {
        tenant: { ...RATING_TENANT.A, customer: link.customer },
        requestId: link.requestId,
        tokenHash: ratingTokenDigest(link.token),
        stars: 5,
        now: BEFORE_EXPIRY.toISOString(),
        attribute: [],
      });
      expect(ratingId).not.toBeNull();
    });
  } finally {
    await db.close();
  }
}

it('accepts an opt-out one millisecond before expiry', async () => {
  const link = await linkFor(RATING_TENANT.A.company);
  now = new Date(link.expiresAt.getTime() - 1);
  const response = await post(link.token);
  expect(response.status).toBe(204);
  expect(await customerOptOutAt(link.companyId, link.customer)).not.toBeNull();
});

it('refuses an opt-out exactly at expiry without changing the customer', async () => {
  const link = await linkFor(RATING_TENANT.A.company);
  now = link.expiresAt;
  const response = await post(link.token);
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('RATING_LINK_UNAVAILABLE');
  expect(await customerOptOutAt(link.companyId, link.customer)).toBeNull();
  expect(await optOutAudits(link.companyId, link.customer)).toHaveLength(0);
});

it('allows a consumed token to opt out before expiry', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(RATING_TENANT.A.company);
  await consume(link);
  const response = await post(link.token);
  expect(response.status).toBe(204);
  expect(await customerOptOutAt(link.companyId, link.customer)).not.toBeNull();
});

it('refuses a consumed token after expiry', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(RATING_TENANT.A.company);
  await consume(link);
  now = new Date(link.expiresAt.getTime() + 1);
  const response = await post(link.token);
  expect(response.status).toBe(404);
  expect(await customerOptOutAt(link.companyId, link.customer)).toBeNull();
});

it('keeps the request expiry unchanged after a successful opt-out', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(RATING_TENANT.A.company);
  const response = await post(link.token);
  expect(response.status).toBe(204);
  const [row] = await h.owner`SELECT expires_at FROM rating_requests
    WHERE company_id=${link.companyId} AND id=${link.requestId}`;
  expect(row?.['expires_at']).toEqual(link.expiresAt);
});

it('keeps one company-wide opt-out across links from two businesses', async () => {
  now = BEFORE_EXPIRY;
  const customer = await newCustomer(RATING_TENANT.A.company);
  const tenant: RatingTenant = { ...RATING_TENANT.A, customer };
  const first = await seedRatingLink(h.owner, { tenant });
  const second = await seedRatingLink(h.owner, {
    tenant: {
      ...tenant,
      business: OTHER_RATING_BUSINESS.business,
      branch: OTHER_RATING_BUSINESS.branch,
    },
  });
  const firstResponse = await post(first.token);
  const firstOptedOutAt = await customerOptOutAt(first.companyId, customer);
  now = LATER;
  const secondResponse = await post(second.token);
  expect(firstResponse.status).toBe(204);
  expect(secondResponse.status).toBe(204);
  expect(await customerOptOutAt(first.companyId, customer)).toEqual(firstOptedOutAt);
  expect(await optOutAudits(first.companyId, customer)).toHaveLength(1);
});

it('leaves platform WhatsApp suppressions untouched', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(RATING_TENANT.A.company);
  const [before] = await h.owner`SELECT count(*)::int AS total FROM platform_whatsapp_suppressions`;
  const response = await post(link.token);
  const [after] = await h.owner`SELECT count(*)::int AS total FROM platform_whatsapp_suppressions`;
  expect(response.status).toBe(204);
  expect(after?.['total']).toBe(before?.['total']);
});
