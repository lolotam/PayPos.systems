import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  RATING_TENANT,
  seedRatingTenants,
} from '../../../../../../packages/db/test/rating-fixtures.ts';
import { startHarness, type Harness } from '../../../../test/harness.ts';
import { seedRatingLink } from '../../../../test/rating-link.fixture.ts';

const ENDPOINT = '/v1/ratings/opt-out';
const OVERSIZED_BODY = 'x'.repeat(1_100_000);
const FORGED_FORWARD = '203.0.113.9';

let h: Harness;
let proxied: Harness;
const logLines: string[] = [];

beforeAll(async () => {
  h = await startHarness({
    logs: {
      write: (chunk: string) => {
        logLines.push(chunk);
      },
    },
  });
  await seedRatingTenants(h.ownerUrl);
  proxied = await startHarness({ trustedProxy: ['127.0.0.1'] });
  await seedRatingTenants(proxied.ownerUrl);
});
afterAll(async () => {
  await h.close();
  await proxied.close();
});

/** A raw body, so a broken or oversized payload reaches the route the way a client would send it. */
async function raw(harness: Harness, body: string) {
  const response = await harness.app.inject({
    method: 'POST',
    url: ENDPOINT,
    headers: { 'content-type': 'application/json' },
    payload: body,
  });
  return { status: response.statusCode, headers: response.headers };
}

it('counts every attempt, whatever the token and the body say, and refuses the thirty-first', async () => {
  const link = await seedRatingLink(h.owner);
  const foreign = `${RATING_TENANT.B.company}.${link.token.split('.')[1]}`;
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const kind = attempt % 5;
    const response =
      kind === 2
        ? await raw(h, '{"broken":')
        : kind === 3
          ? await raw(h, OVERSIZED_BODY)
          : await h.send('POST', ENDPOINT, {
              cookie: '',
              headers: {
                [RATING_TOKEN_HEADER]: kind === 0 ? link.token : foreign,
                ...(kind === 4 ? { 'x-forwarded-for': FORGED_FORWARD } : {}),
                ...(kind === 1 ? { 'x-request-id': link.token } : {}),
              },
            });
    statuses.push(response.status);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    if (kind === 1) expect(response.headers['x-request-id']).not.toBe(link.token);
  }
  expect(statuses.filter((status) => status === 204)).toHaveLength(6);
  expect(statuses.filter((status) => status === 404)).toHaveLength(12);
  expect(statuses.filter((status) => status === 400)).toHaveLength(6);
  expect(statuses.filter((status) => status === 413)).toHaveLength(6);
  const tenantCallsBefore = h.calls.tenant.length;
  const refused = await h.send('POST', ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: 'malformed', 'x-forwarded-for': FORGED_FORWARD },
  });
  expect(refused.status).toBe(429);
  expect(refused.body['code']).toBe('TOO_MANY_REQUESTS');
  expect(Number(refused.headers['retry-after'])).toBeGreaterThanOrEqual(1);
  expect(h.calls.tenant.length).toBe(tenantCallsBefore);
  expect(logLines.join('')).not.toContain(link.token);
});

it('gives two clients behind a trusted proxy a bucket each', async () => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await proxied.send('POST', ENDPOINT, {
      cookie: '',
      headers: { [RATING_TOKEN_HEADER]: 'malformed', 'x-forwarded-for': '203.0.113.1' },
    });
    expect(response.status).toBe(404);
  }
  const refused = await proxied.send('POST', ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: 'malformed', 'x-forwarded-for': '203.0.113.1' },
  });
  expect(refused.status).toBe(429);
  const other = await proxied.send('POST', ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: 'malformed', 'x-forwarded-for': '203.0.113.2' },
  });
  expect(other.status).toBe(404);
});
