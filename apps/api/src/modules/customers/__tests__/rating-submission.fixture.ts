import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import { createDatabase } from '@pospay/db';
import { randomUUID } from 'node:crypto';

import {
  claimRequest,
  insertRequest,
  RATING_TENANT,
  seedRatingTenants,
  type RatingTenant,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import {
  RATING_LINK_LIFETIME_MS,
  ratingToken,
  ratingTokenDigest,
  seedRatingLink,
} from '../../../../test/rating-link.fixture.ts';

/** لحظة المطالبة: بتحدد بداية صلاحية الرابط وآخر لحظة يقبل فيها الاستهلاك. */
export const CLAIMED_AT = new Date('2026-06-01T00:00:00Z');
/** لحظة قبل الانتهاء، جوه نافذة الرابط. */
export const BEFORE_EXPIRY = new Date('2026-06-02T00:00:00Z');

export const VIEW_ENDPOINT = '/v1/ratings/view';
export const SUBMIT_ENDPOINT = '/v1/ratings/submit';

export interface RatingLink {
  readonly token: string;
  readonly requestId: string;
  readonly companyId: string;
  readonly customer: string;
  readonly expiresAt: Date;
}

/** The context every rating spec file needs: the harness and the clock it reads. */
export interface RatingContext {
  readonly harness: Harness;
  /** The moment the API believes it is; the specs move it around the expiry. */
  setNow(at: Date): void;
}

let phones = 0;

/**
 * Starts the API with a frozen customers clock, so the specs can walk the link across its expiry.
 *
 * @returns the running harness and the clock handle
 */
export async function startRatingContext(): Promise<RatingContext> {
  let now = BEFORE_EXPIRY;
  const harness = await startHarness({
    customersClock: { now: () => now },
    // مهلة أطول من المعتادة: الطلبان المتوازيان بيستناوا قفل بعض، والاختبار مش عايز 503 من مهلة.
    customersTransactionTimeoutMs: 5_000,
  });
  await seedRatingTenants(harness.ownerUrl);
  return {
    harness,
    setNow: (at: Date) => {
      now = at;
    },
  };
}

/**
 * A customer of the company, with the locale the Arabic page expects.
 *
 * @param harness the running harness
 * @param companyId the company the customer belongs to
 * @returns the customer id
 */
export async function newCustomer(harness: Harness, companyId: string): Promise<string> {
  phones += 1;
  const id = randomUUID();
  const phone = `+1777${String(phones).padStart(7, '0')}`;
  await harness.owner`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at)
    VALUES (${companyId}, ${id}, 'Synthetic customer', ${phone}, 'ar', now(), now())`;
  return id;
}

/**
 * A claimed rating link with no performer snapshot, the way the worker claims one.
 *
 * @param harness the running harness
 * @param tenantKey the company the link belongs to
 * @returns the link the customer holds
 */
export async function linkFor(harness: Harness, tenantKey: 'A' | 'B'): Promise<RatingLink> {
  const base = RATING_TENANT[tenantKey];
  const customer = await newCustomer(harness, base.company);
  const tenant: RatingTenant = { ...base, customer };
  const link = await seedRatingLink(harness.owner, { tenant });
  return { ...link, customer };
}

/**
 * A claimed rating link with its performer snapshot, the way the worker claims one.
 * The claim and the snapshot have to be one transaction: the database only lets the
 * claiming transaction write the performers.
 *
 * @param harness   the running harness
 * @param tenantKey the company the link belongs to
 * @param performers the employees the rating belongs to
 * @returns the link the customer holds
 */
export async function linkWithPerformers(
  harness: Harness,
  tenantKey: 'A' | 'B',
  performers: readonly string[],
): Promise<RatingLink> {
  const base = RATING_TENANT[tenantKey];
  const customer = await newCustomer(harness, base.company);
  const tenant: RatingTenant = { ...base, customer };
  const token = ratingToken(base.company);
  const database = createDatabase({ url: harness.urls.app, ids: { newId: randomUUID } });
  try {
    const requestId = await database.withTenant(base.company, async (tx) => {
      const id = await insertRequest(tx, { tenant });
      await claimRequest(tx, {
        tenant,
        requestId: id,
        tokenHash: ratingTokenDigest(token),
        readyEventId: randomUUID(),
        now: CLAIMED_AT,
        performers,
      });
      return id;
    });
    return {
      token,
      requestId,
      companyId: base.company,
      customer,
      expiresAt: new Date(CLAIMED_AT.getTime() + RATING_LINK_LIFETIME_MS),
    };
  } finally {
    await database.close();
  }
}

/**
 * @param harness the running harness
 * @param token   the token the customer holds
 * @returns the view response
 */
export function viewRequest(harness: Harness, token: string) {
  return harness.send('GET', VIEW_ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: token },
  });
}

/**
 * @param harness the running harness
 * @param token   the token the customer holds
 * @param body    the rating body
 * @returns the submit response
 */
export function submitRequest(harness: Harness, token: string, body: object = { stars: 5 }) {
  return harness.send('POST', SUBMIT_ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: token },
    body,
  });
}

/**
 * @param harness   the running harness
 * @param companyId the company the ratings belong to
 * @param requestId the request the ratings belong to
 * @returns the rating rows of that request
 */
export async function ratingsForRequest(
  harness: Harness,
  companyId: string,
  requestId: string,
): Promise<readonly Record<string, unknown>[]> {
  return harness.owner`SELECT id, stars, comment FROM ratings
    WHERE company_id=${companyId} AND request_id=${requestId}`;
}

/**
 * @param harness   the running harness
 * @param companyId the company the request belongs to
 * @param requestId the request
 * @returns the moment the link was consumed, or null
 */
export async function consumedAt(
  harness: Harness,
  companyId: string,
  requestId: string,
): Promise<Date | null> {
  const [row] = await harness.owner`SELECT consumed_at FROM rating_requests
    WHERE company_id=${companyId} AND id=${requestId}`;
  const value = row?.['consumed_at'];
  return value === null || value === undefined ? null : (value as Date);
}

/**
 * @param harness   the running harness
 * @param companyId the company the attributions belong to
 * @param requestId the request the attributions belong to
 * @returns the attributed employees, in a stable order
 */
export async function attributedEmployees(
  harness: Harness,
  companyId: string,
  requestId: string,
): Promise<readonly unknown[]> {
  const rows = await harness.owner`SELECT employee_id FROM rating_attributions
    WHERE company_id=${companyId} AND request_id=${requestId} ORDER BY employee_id`;
  return rows.map((row) => row['employee_id']);
}
