import { errorEnvelope, staffColumnsSettings } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';

// MY-Q5 (#496): أعمدة تطبيق الموظفين صلاحية مستقلة عن إدارة الإعدادات، فالـ PUT بيحتاجها لوحدها.
let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const url = () => `/v1/businesses/${f.business}/settings/staff-columns`;
let keys = 0;
const headers = (cookie: string) => ({ cookie, 'x-company-id': f.company });
const get = (cookie: string) =>
  f.h.app.inject({ method: 'GET', url: url(), headers: headers(cookie) });
const put = (cookie: string) =>
  f.h.app.inject({
    method: 'PUT',
    url: url(),
    headers: { ...headers(cookie), 'idempotency-key': `staff-columns-permission-${++keys}` },
    payload: { columns: ['date'], months_back: 2 },
  });
const dropOverride = (id: string) =>
  f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`;
const storedRow = async () => {
  const [row] = await f.h.owner`SELECT staff_columns, staff_months_back FROM business_settings
    WHERE company_id = ${f.company} AND business_id = ${f.business}`;
  return row ?? { staff_columns: null, staff_months_back: null };
};

it('a caller with only manage:settings:business is refused on the PUT and on the GET', async () => {
  const override = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:settings:business',
  });
  const saved = await put(f.managerCookie);
  expect(saved.statusCode).toBe(403);
  expect(errorEnvelope.parse(saved.json()).code).toBe('FORBIDDEN');
  const read = await get(f.managerCookie);
  expect(read.statusCode).toBe(403);
  expect(errorEnvelope.parse(read.json()).code).toBe('FORBIDDEN');
  const row = await storedRow();
  expect(row.staff_columns).toBeNull();
  await dropOverride(override);
});

it('a caller with only manage:staff-app-columns:business saves and reads', async () => {
  const override = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:staff-app-columns:business',
  });
  const saved = await put(f.managerCookie);
  expect(saved.statusCode).toBe(200);
  expect(staffColumnsSettings.parse(saved.json())).toMatchObject({
    business_id: f.business,
    columns: ['date'],
    months_back: 2,
  });
  const read = await get(f.managerCookie);
  expect(read.statusCode).toBe(200);
  expect(staffColumnsSettings.parse(read.json())).toMatchObject({
    columns: ['date'],
    months_back: 2,
  });
  const row = await storedRow();
  expect(row.staff_columns).toEqual(['date']);
  expect(row.staff_months_back).toBe(2);
  await dropOverride(override);
});

it('the owner, the general manager and the business manager hold it by default', async () => {
  const rows = await f.h.owner`SELECT r.code FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id AND r.company_id IS NULL
    WHERE rp.role_owner_key = 'global' AND rp.permission_code = 'manage:staff-app-columns:business'
    ORDER BY r.code`;
  expect(rows.map((row) => row['code'])).toEqual(['business_manager', 'general_manager', 'owner']);
  const saved = await put(f.cookie);
  expect(saved.statusCode).toBe(200);
  expect(staffColumnsSettings.parse(saved.json()).business_id).toBe(f.business);
});

it('a device membership holding an ALLOW override for it is still refused', async () => {
  const deviceRole = SYSTEM_ROLES.find((role) => role.code === 'device')?.id ?? '';
  await f.h.owner`UPDATE memberships SET role_id=${deviceRole}, role_owner_key='global',
    scope_type='BRANCH', scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
  const override = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:staff-app-columns:business',
  });
  expect((await put(f.managerCookie)).statusCode).toBe(403);
  expect((await get(f.managerCookie)).statusCode).toBe(403);
  await dropOverride(override);
});
