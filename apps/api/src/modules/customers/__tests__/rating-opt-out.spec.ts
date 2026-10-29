import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  RATING_TENANT,
  seedRatingTenants,
  type RatingTenant,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { seedRatingLink } from '../../../../test/rating-link.fixture.ts';
import { ratingTokenHash } from '../persistence/rating-token-hash.adapter.ts';

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

/** A customer of its own for every case, so one case never inherits another's opt-out. */
async function newCustomer(companyId: string): Promise<string> {
  phones += 1;
  const id = randomUUID();
  const phone = `+1999${String(phones).padStart(7, '0')}`;
  await h.owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${companyId}, ${id}, 'Synthetic customer', ${phone}, 'ar', now(), now())`;
  return id;
}

function post(token?: string, cookie = '') {
  return h.send('POST', ENDPOINT, {
    cookie,
    ...(token === undefined ? {} : { headers: { [RATING_TOKEN_HEADER]: token } }),
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
      AND action='customer.opted_out'`;
}

async function linkFor(companyId: string, claimedAt?: Date) {
  const customer = await newCustomer(companyId);
  const tenant: RatingTenant = { ...RATING_TENANT.A, customer };
  const link = await seedRatingLink(h.owner, {
    tenant,
    ...(claimedAt === undefined ? {} : { claimedAt }),
  });
  return { ...link, customer };
}

it('hashes the token with SHA-256', () => {
  const hash = ratingTokenHash();
  expect(hash.sha256('').toString('hex')).toBe(
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  expect(hash.sha256('abc').toString('hex')).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

it('marks the customer and answers 204 with no body', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(RATING_TENANT.A.company);
  const response = await post(link.token);
  expect(response.status).toBe(204);
  expect(response.text).toBe('');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(await customerOptOutAt(link.companyId, link.customer)).not.toBeNull();
  expect(await optOutAudits(link.companyId, link.customer)).toHaveLength(1);
});

it('refuses a missing header', async () => {
  const response = await post();
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('RATING_LINK_UNAVAILABLE');
});

it('refuses a malformed token', async () => {
  const response = await post('not-a-token');
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('RATING_LINK_UNAVAILABLE');
});

it('refuses an unknown token', async () => {
  const response = await post(`${RATING_TENANT.A.company}.${'A'.repeat(43)}`);
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('RATING_LINK_UNAVAILABLE');
});

it('refuses a token whose random part was altered', async () => {
  const link = await linkFor(RATING_TENANT.A.company);
  const [prefix, secret] = link.token.split('.');
  const altered = `${prefix}.${secret?.slice(0, 42)}${(secret?.slice(-1) === 'A' ? 'B' : 'A')}`;
  const response = await post(altered);
  expect(response.status).toBe(404);
  expect(await customerOptOutAt(link.companyId, link.customer)).toBeNull();
  expect(await optOutAudits(link.companyId, link.customer)).toHaveLength(0);
});

it('refuses a token whose prefix belongs to another company', async () => {
  const link = await linkFor(RATING_TENANT.A.company);
  const foreign = `${RATING_TENANT.B.company}.${link.token.split('.')[1]}`;
  const response = await post(foreign);
  expect(response.status).toBe(404);
  expect(await customerOptOutAt(link.companyId, link.customer)).toBeNull();
  expect(await optOutAudits(link.companyId, link.customer)).toHaveLength(0);
});

it('refuses a link whose seven days are over', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(RATING_TENANT.A.company, new Date('2026-05-01T00:00:00Z'));
  const response = await post(link.token);
  expect(response.status).toBe(404);
  expect(response.body['code']).toBe('RATING_LINK_UNAVAILABLE');
  expect(await customerOptOutAt(link.companyId, link.customer)).toBeNull();
});

it('keeps the first time and one audit row when the customer opts out again later', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(RATING_TENANT.A.company);
  const first = await post(link.token);
  const optedOutAt = await customerOptOutAt(link.companyId, link.customer);
  now = LATER;
  const second = await post(link.token);
  expect(first.status).toBe(204);
  expect(second.status).toBe(204);
  expect(await customerOptOutAt(link.companyId, link.customer)).toEqual(optedOutAt);
  expect(await optOutAudits(link.companyId, link.customer)).toHaveLength(1);
});

it('changes nothing because of another company session', async () => {
  now = BEFORE_EXPIRY;
  const link = await linkFor(RATING_TENANT.A.company);
  const cookie = await h.signedInOperator('other-owner@example.test');
  const otherCompany = await h.onboard(cookie, 'Other Company');
  const response = await post(link.token, cookie);
  expect(response.status).toBe(204);
  expect(await customerOptOutAt(link.companyId, link.customer)).not.toBeNull();
  const [row] = await h.owner`SELECT count(*)::int AS total FROM customers
    WHERE company_id=${otherCompany}`;
  expect(row?.['total']).toBe(0);
});
