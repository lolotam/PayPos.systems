import { createDatabase, SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import type { PermissionOverrideInput } from '@pospay/contracts';
import { startHarness, type Harness } from '../../../../test/harness.ts';

const ids = systemUuidV7();
const role = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';

export async function permissionFixture() {
  const h = await startHarness();
  const cookie = await h.signedInOperator('permissions@example.test');
  const managerCookie = await h.signedInOperator('permission-editor@example.test');
  const company = await h.onboard(cookie, 'Permissions A');
  const otherCompany = await h.onboard(cookie, 'Permissions B');
  const users =
    await h.owner`SELECT id, email FROM "user" WHERE email IN ('permissions@example.test', 'permission-editor@example.test')`;
  const userId = users.find((u) => u['email'] === 'permissions@example.test')?.['id'] as string;
  const managerId = users.find((u) => u['email'] === 'permission-editor@example.test')?.[
    'id'
  ] as string;
  const [own] =
    await h.owner`SELECT id FROM memberships WHERE company_id = ${company} AND user_id = ${userId}`;
  const ownMember = own?.['id'] as string;
  const managerMember = ids.newId();
  await h.owner`INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${company}, ${managerMember}, ${managerId}, ${role('viewer')}, 'global', 'COMPANY', ${company})`;
  const business = await newBusiness(h, company);
  const branch = await newBranch(h, company, business);
  const siblingBranch = await newBranch(h, company, business);
  const otherBusiness = await newBusiness(h, company);
  const foreignBusiness = await newBusiness(h, otherCompany);
  const foreignBranch = await newBranch(h, otherCompany, foreignBusiness);
  const db = createDatabase({ url: h.urls.app, ids });
  return {
    h,
    ids,
    db,
    cookie,
    managerCookie,
    company,
    otherCompany,
    userId,
    managerId,
    ownMember,
    managerMember,
    business,
    branch,
    siblingBranch,
    otherBusiness,
    foreignBranch,
  };
}
export type PermissionFixture = Awaited<ReturnType<typeof permissionFixture>>;

async function newBusiness(h: Harness, company: string) {
  const id = ids.newId();
  await h.owner`INSERT INTO businesses (company_id, id, name_en, vertical_type)
    VALUES (${company}, ${id}, 'Synthetic business', 'salon')`;
  return id;
}
async function newBranch(h: Harness, company: string, business: string) {
  const id = ids.newId();
  await h.owner`INSERT INTO branches (company_id, id, business_id, name_en)
    VALUES (${company}, ${id}, ${business}, 'Synthetic branch')`;
  return id;
}
export async function newMember(f: PermissionFixture, code = 'viewer', company = f.company) {
  const id = ids.newId();
  await f.h
    .owner`INSERT INTO memberships (company_id, id, employee_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${company}, ${id}, ${ids.newId()}, ${role(code)}, 'global', 'COMPANY', ${company})`;
  return id;
}
export function terms(
  f: PermissionFixture,
  change: Partial<PermissionOverrideInput> = {},
): PermissionOverrideInput {
  return {
    permission_code: 'read:settings:business',
    effect: 'ALLOW',
    scope_type: 'COMPANY',
    scope_id: f.company,
    reason: 'Synthetic change',
    expires_at: null,
    ...change,
  };
}
export async function seedOverride(
  f: PermissionFixture,
  member: string,
  change: Partial<PermissionOverrideInput> = {},
) {
  const input = terms(f, change);
  const id = ids.newId();
  await f.h.owner`INSERT INTO permission_overrides
    (company_id, id, membership_id, permission_code, effect, scope_type, scope_id, reason, granted_by, expires_at)
    VALUES (${f.company}, ${id}, ${member}, ${input.permission_code}, ${input.effect}, ${input.scope_type},
      ${input.scope_id}, ${input.reason}, ${f.userId}, ${input.expires_at})`;
  return id;
}
export function save(
  f: PermissionFixture,
  member: string,
  change: Partial<PermissionOverrideInput> = {},
  cookie = f.cookie,
) {
  return f.h.send('POST', `/v1/permissions/memberships/${member}/overrides`, {
    cookie,
    company: f.company,
    body: terms(f, change),
  });
}
export function revoke(
  f: PermissionFixture,
  member: string,
  id: string,
  cookie = f.cookie,
  reason = 'Synthetic revoke',
) {
  return f.h.send('POST', `/v1/permissions/memberships/${member}/overrides/${id}/revoke`, {
    cookie,
    company: f.company,
    body: { reason },
  });
}
