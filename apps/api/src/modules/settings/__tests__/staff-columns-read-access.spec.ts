import { errorEnvelope, staffColumnsSettings } from '@pospay/contracts';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';
import { deviceToken } from './set-business-logo.support.ts';

// MY-Q10 (PP-27.1، MY-Q5): قراءة أعمدة تطبيق الموظفات مفتوحة بصلاحية القراءة أو بصلاحية أعمدة تطبيق الموظفين، كل واحدة في عضوية.
let f: PermissionFixture;

beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const url = () => `/v1/businesses/${f.business}/settings/staff-columns`;
const get = (headers: Record<string, string>) =>
  f.h.app.inject({ method: 'GET', url: url(), headers });

// A member of the company with a role of its own and one permission, so the grants are exactly that one.
const memberWith = async (email: string, code: string, permission: string) => {
  const cookie = await f.h.signedInOperator(email);
  const [user] = await f.h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  const roleId = f.ids.newId();
  await f.h.owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES (${roleId}, ${f.company}, ${code}, 'Synthetic staff columns reader')`;
  const memberId = f.ids.newId();
  await f.h
    .owner`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${f.company}, ${memberId}, ${user?.['id'] as string}, ${roleId}, ${f.company}, 'COMPANY', ${f.company})`;
  await seedOverride(f, memberId, { permission_code: permission });
  return cookie;
};

it('a member with only read:settings:business reads the staff columns', async () => {
  await seedOverride(f, f.managerMember, { permission_code: 'read:settings:business' });
  const res = await get({ cookie: f.managerCookie, 'x-company-id': f.company });
  expect(res.statusCode).toBe(200);
  expect(staffColumnsSettings.parse(res.json())).toMatchObject({
    business_id: f.business,
    columns_default: true,
    months_back: 2,
  });
});

it('a member with only manage:staff-app-columns:business reads the staff columns', async () => {
  const cookie = await memberWith(
    'staff-columns-columns@example.test',
    'synthetic_columns_editor',
    'manage:staff-app-columns:business',
  );
  const res = await get({ cookie, 'x-company-id': f.company });
  expect(res.statusCode).toBe(200);
  expect(staffColumnsSettings.parse(res.json())).toMatchObject({
    business_id: f.business,
  });
});

it('a member with only manage:settings:business is refused', async () => {
  const cookie = await memberWith(
    'staff-columns-settings@example.test',
    'synthetic_columns_settings',
    'manage:settings:business',
  );
  const res = await get({ cookie, 'x-company-id': f.company });
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
});

it('a member with neither permission is refused', async () => {
  const cookie = await memberWith(
    'staff-columns-plain@example.test',
    'synthetic_columns_plain',
    'read:attendance:branch',
  );
  const res = await get({ cookie, 'x-company-id': f.company });
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
});

it('a device token is refused', async () => {
  const token = await deviceToken(f);
  const res = await get({ authorization: `Device ${token}`, 'x-company-id': f.company });
  expect([res.statusCode, errorEnvelope.parse(res.json()).code]).toEqual([403, 'FORBIDDEN']);
});
