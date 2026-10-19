import { businessLogo } from '@pospay/contracts';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { permissionFixture, type PermissionFixture } from '../../../../test/permissions-fixture.ts';
import { insertLogoFile } from './set-business-logo.support.ts';

let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
beforeEach(async () => {
  await f.h.owner`UPDATE business_settings SET logo_file_id = NULL
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  await f.h.redis.del(`settings:${f.company}:${f.business}:generation`);
});

it('binds a legacy settings file whose stored permission is read:settings:business', async () => {
  const id = await insertLogoFile(f, { requiredPermission: 'read:settings:business' });
  const res = await f.h.app.inject({
    method: 'PUT',
    url: `/v1/businesses/${f.business}/settings/logo`,
    headers: { cookie: f.cookie, 'x-company-id': f.company },
    payload: { file_id: id },
  });
  expect(res.statusCode).toBe(200);
  expect(businessLogo.parse(res.json())).toEqual({ logo_file_id: id });
});
