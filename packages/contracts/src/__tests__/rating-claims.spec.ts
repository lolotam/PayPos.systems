import { describe, expect, it } from 'vitest';

import { ratingClaimsJob, ratingClaimsDiscoveryPayload } from '../customers/rating-claims.js';

const COMPANY = '01920000-0000-7000-8000-0000000000b2';
const LEGACY_CURSOR = { dueAt: '2026-01-01T00:00:00.000Z', id: COMPANY };

it('discovery carries no tenant data, token or cursor in its payload', () => {
  expect(ratingClaimsDiscoveryPayload.parse({})).toEqual({});
  for (const payload of [{ companyId: COMPANY }, { token: 'synthetic' }, { after: LEGACY_CURSOR }])
    expect(ratingClaimsDiscoveryPayload.safeParse(payload).success).toBe(false);
});

describe('rating claims job', () => {
  it('accepts a job that carries only the company', () => {
    expect(ratingClaimsJob.parse({ companyId: COMPANY })).toEqual({ companyId: COMPANY });
  });

  it('refuses a job that still carries the legacy page cursor', () => {
    const legacy = { companyId: COMPANY, after: LEGACY_CURSOR };
    expect(ratingClaimsJob.safeParse(legacy).success).toBe(false);
  });

  it('refuses a job that carries an extra key', () => {
    expect(ratingClaimsJob.safeParse({ companyId: COMPANY, extra: 'nope' }).success).toBe(false);
  });

  it('refuses a company that is not a uuid', () => {
    expect(ratingClaimsJob.safeParse({ companyId: 'not-a-uuid' }).success).toBe(false);
  });
});
