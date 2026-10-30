import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  insertRequest,
  RATING_TENANT,
  type RatingTenant,
} from '../../../packages/db/test/rating-fixtures.ts';
import type postgres from 'postgres';

/** The lifetime the database enforces: seven days from the claim. */
export const RATING_LINK_LIFETIME_MS = 604_800_000;

/**
 * A canonical rating token for a company: the prefix plus 43 base64url characters.
 * The last character of the random part always has its two low bits zero, because 32 bytes
 * leave four real bits in it.
 *
 * @param companyId the company the link belongs to
 * @returns the token the client sends in the header
 */
export function ratingToken(companyId: string): string {
  return `${companyId}.${randomBytes(32).toString('base64url')}`;
}

/**
 * @param token the canonical token
 * @returns the SHA-256 digest the token is stored as
 */
export function ratingTokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export interface SeededRatingLink {
  readonly token: string;
  readonly requestId: string;
  readonly companyId: string;
  readonly customerId: string;
  readonly expiresAt: Date;
}

/**
 * Seeds a rating request that carries a token, the way the worker's claim does: the request starts
 * scheduled and without a token, and the claim is what gives it the token and the expiry.
 *
 * @param owner   the owner's connection to the test database
 * @param options the tenant and the moment the link was claimed
 * @returns the token and what it points at
 */
export async function seedRatingLink(
  owner: postgres.Sql,
  options: { readonly tenant?: RatingTenant; readonly claimedAt?: Date } = {},
): Promise<SeededRatingLink> {
  const tenant = options.tenant ?? RATING_TENANT.A;
  const token = ratingToken(tenant.company);
  const requestId = await insertRequest(owner, { tenant });
  const claimedAt = options.claimedAt ?? new Date('2026-06-01T00:00:00Z');
  const expiresAt = new Date(claimedAt.getTime() + RATING_LINK_LIFETIME_MS);
  const stamp = claimedAt.toISOString();
  await owner`UPDATE rating_requests
      SET status='SENDING', token_hash=${ratingTokenDigest(token)}, token_key_version=1,
        claimed_at=${stamp}::timestamptz, expires_at=${expiresAt.toISOString()}::timestamptz,
        ready_event_id=${randomUUID()}::uuid, updated_at=${stamp}::timestamptz
    WHERE company_id=${tenant.company} AND id=${requestId}`;
  return { token, requestId, companyId: tenant.company, customerId: tenant.customer, expiresAt };
}
