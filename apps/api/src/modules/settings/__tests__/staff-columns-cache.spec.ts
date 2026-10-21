import { businessSettings } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { permissionFixture, type PermissionFixture } from '../../../../test/permissions-fixture.ts';

// The settings read is cached in Redis; a staff-columns write changes the same row, so it must invalidate it.
let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const headers = () => ({ cookie: f.cookie, 'x-company-id': f.company });
const read = () =>
  f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/settings`,
    headers: headers(),
  });
const write = (body: object, key: string) =>
  f.h.app.inject({
    method: 'PUT',
    url: `/v1/businesses/${f.business}/settings/staff-columns`,
    headers: { ...headers(), 'idempotency-key': key },
    payload: body,
  });

it('a staff-columns write invalidates the cached settings read', async () => {
  const before = await read();
  expect(before.statusCode).toBe(200);
  const cached = businessSettings.parse(before.json());
  expect(cached.updated_at).toBeNull();

  const saved = await write({ columns: ['date', 'tip'], months_back: 2 }, 'staff-columns-cache');
  expect(saved.statusCode).toBe(200);

  const after = await read();
  expect(after.statusCode).toBe(200);
  const fresh = businessSettings.parse(after.json());
  expect(fresh.updated_at).not.toBeNull();
  expect(fresh.updated_at).not.toBe(cached.updated_at);
});
