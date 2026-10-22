import { SYSTEM_ROLES } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  permissionFixture,
  seedOverride,
  type PermissionFixture,
} from '../../../../test/permissions-fixture.ts';

let f: PermissionFixture;
beforeAll(async () => {
  f = await permissionFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

type RouteRequest = {
  readonly method: 'GET' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: object;
};
// المسار وبيانه المتوقع عند الوصول: الرفض 403، والوصول بالرد المتوقّع لكل مسار.
type RouteSpec = RouteRequest & { readonly expected: number };

const businessPath = () => `/v1/businesses/${f.business}/alert-rules`;
const branchPath = () => `/v1/businesses/${f.business}/branches/${f.branch}/alert-rules`;
// قاعدة واحدة صالحة: أول حفظ في كل نطاق بيبعت معرّف الصف ونسخته null، فبينحفظ فعلاً.
const firstRule = {
  kind: 'SHIFT_NOT_CLOCKED_IN',
  enabled: true,
  recipient_roles: ['owner', 'branch_manager'],
  channels: ['IN_APP'],
  delay_minutes: 15,
  lead_minutes: null,
  expected_rule_id: null,
  expected_revision: null,
};
// المسارات الستة بتاعة قواعد التنبيه: قراءة النشاط وحفظه والمفتاح العام، وقراءة فرع وحفظه ومسح قاعدته.
const routes = (): RouteSpec[] => [
  { method: 'GET', path: businessPath(), expected: 200 },
  { method: 'PUT', path: businessPath(), body: { rules: [firstRule] }, expected: 200 },
  { method: 'PUT', path: `${businessPath()}/master`, body: { alerts_enabled: true }, expected: 200 },
  { method: 'GET', path: branchPath(), expected: 200 },
  { method: 'PUT', path: branchPath(), body: { rules: [firstRule] }, expected: 200 },
  {
    method: 'DELETE',
    path: `${branchPath()}/SHIFT_NOT_CLOCKED_IN?expected_rule_id=${f.ids.newId()}&expected_revision=1`,
    expected: 409,
  },
];
const call = (spec: RouteRequest, cookie: string) =>
  f.h.send(spec.method, spec.path, {
    cookie,
    company: f.company,
    ...(spec.body === undefined ? {} : { body: spec.body }),
  });
const dropOverride = (id: string) =>
  f.h.owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${id}`;

it('AL-Q1: a caller with only manage:settings:business is refused on every alert-rules route', async () => {
  const override = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:settings:business',
  });
  for (const spec of routes()) {
    const response = await call(spec, f.managerCookie);
    expect(response.status, `${spec.method} ${spec.path}`).toBe(403);
  }
  await dropOverride(override);
});

it('AL-Q1: a caller with only manage:alert-rules:business succeeds on every route', async () => {
  const override = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:alert-rules:business',
  });
  for (const spec of routes()) {
    const response = await call(spec, f.managerCookie);
    expect(response.status, `${spec.method} ${spec.path}`).toBe(spec.expected);
    if (spec.method === 'DELETE')
      expect(response.body).toMatchObject({ code: 'ALERT_RULE_REVISION_CONFLICT' });
  }
  await dropOverride(override);
});

it('AL-Q1: the owner, the general manager and the business manager hold it by default', async () => {
  const rows = await f.h.owner`SELECT r.code FROM role_permissions rp
    JOIN roles r ON r.id = rp.role_id AND r.company_id IS NULL
    WHERE rp.role_owner_key = 'global' AND rp.permission_code = 'manage:alert-rules:business'
    ORDER BY r.code`;
  expect(rows.map((row) => row['code'])).toEqual(['business_manager', 'general_manager', 'owner']);
  const response = await call({ method: 'GET', path: businessPath() }, f.cookie);
  expect(response.status).toBe(200);
});

it('AL-Q1: a device membership holding an ALLOW override for it is still refused', async () => {
  const deviceRole = SYSTEM_ROLES.find((role) => role.code === 'device')?.id ?? '';
  await f.h.owner`UPDATE memberships SET role_id=${deviceRole}, role_owner_key='global',
    scope_type='BRANCH', scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.managerMember}`;
  const override = await seedOverride(f, f.managerMember, {
    permission_code: 'manage:alert-rules:business',
  });
  const response = await call({ method: 'GET', path: businessPath() }, f.managerCookie);
  expect(response.status).toBe(403);
  await dropOverride(override);
});
