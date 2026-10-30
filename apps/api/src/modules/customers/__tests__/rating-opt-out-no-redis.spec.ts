import { RATING_TOKEN_HEADER } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';

const ENDPOINT = '/v1/ratings/opt-out';

let withoutRedis: Harness;
let unavailable: Harness;

beforeAll(async () => {
  withoutRedis = await startHarness({ omitRedis: true });
  unavailable = await startHarness({ ratingLinksAvailable: false });
});
afterAll(async () => {
  await withoutRedis.close();
  await unavailable.close();
});

it('answers 503 when there is no limiter at all, before touching the database', async () => {
  const response = await withoutRedis.send('POST', ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: 'any-token' },
  });
  expect(response.status).toBe(503);
  expect(response.body['code']).toBe('NOT_READY');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.headers['referrer-policy']).toBe('no-referrer');
  expect(withoutRedis.calls.tenant).toEqual([]);
});

it('answers 503 when the capability is not available, before touching the database', async () => {
  const response = await unavailable.send('POST', ENDPOINT, {
    cookie: '',
    headers: { [RATING_TOKEN_HEADER]: 'any-token' },
  });
  expect(response.status).toBe(503);
  expect(response.body['code']).toBe('NOT_READY');
  expect(response.headers['cache-control']).toBe('no-store');
  expect(unavailable.calls.tenant).toEqual([]);
});
