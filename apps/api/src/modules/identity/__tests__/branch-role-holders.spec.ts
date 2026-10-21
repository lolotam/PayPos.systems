import { afterAll, beforeAll, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@pospay/db';
import type { AlertRecipientRole } from '@pospay/domain';
import { readBranchRoleHolders } from '../index.ts';
import { permissionFixture, type PermissionFixture } from './permissions-screen.fixture.ts';

let f: PermissionFixture;
const at = new Date('2026-10-04T10:00:00Z');
beforeAll(async () => {
  f = await permissionFixture();
  // العضويات بتبدأ بوقت حقيقي، والقراءة بلحظة ثابتة فبدون التصحيح دي كلهم هيتحسبوا "لسه ما بدأوش".
  await f.h.owner`UPDATE memberships SET starts_at='2026-01-01T00:00:00Z'
    WHERE company_id=${f.company} AND starts_at>'2026-01-01T00:00:00Z'`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

const newUser = async (email: string) => {
  await f.h.signedInOperator(email);
  const [row] = await f.h.owner`SELECT id FROM "user" WHERE email=${email}`;
  return row?.['id'] as string;
};
const membership = async (
  userId: string,
  roleCode: string,
  scopeType: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
  endsAt: string | null = null,
) => {
  const id = f.ids.newId();
  const role = SYSTEM_ROLES.find((entry) => entry.code === roleCode)?.id as string;
  await f.h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES (${f.company},${id},${userId},${role},'global',${scopeType},${scopeId},'2026-01-01',${endsAt})`;
  return id;
};
const holders = (roles: readonly AlertRecipientRole[], branchId = f.branch) =>
  f.db.withTenant(f.company, (tx) =>
    readBranchRoleHolders(tx, f.company, f.business, branchId, roles, at),
  );

it('reads nobody for an empty role list', async () => {
  expect(await holders([])).toEqual([]);
});

it('the company owner holds the owner role in every branch and is flagged as an owner', async () => {
  expect(await holders(['owner'])).toEqual([{ userId: f.userId, owner: true }]);
});

it('a company, business or branch membership covers the branch; another branch and an ended one do not', async () => {
  const company = await newUser('role-company@example.test');
  const business = await newUser('role-business@example.test');
  const branch = await newUser('role-branch@example.test');
  const elsewhere = await newUser('role-elsewhere@example.test');
  const ended = await newUser('role-ended@example.test');
  await membership(company, 'general_manager', 'COMPANY', f.company);
  await membership(business, 'general_manager', 'BUSINESS', f.business);
  await membership(branch, 'general_manager', 'BRANCH', f.branch);
  await membership(elsewhere, 'general_manager', 'BRANCH', f.siblingBranch);
  await membership(ended, 'general_manager', 'BRANCH', f.branch, '2026-10-01');
  expect(await holders(['general_manager'])).toEqual(
    [company, business, branch]
      .sort()
      .map((userId) => ({ userId, owner: false })),
  );
});

it('a company role that copies a system code is not a system role, and one user with two memberships is listed once', async () => {
  const custom = await newUser('role-custom@example.test');
  const roleId = f.ids.newId();
  await f.h.owner`INSERT INTO roles (id,company_id,code,name_en)
    VALUES (${roleId},${f.company},'branch_manager','Synthetic branch manager')`;
  await f.h.owner`INSERT INTO memberships (company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES (${f.company},${f.ids.newId()},${custom},${roleId},${f.company},'COMPANY',${f.company},'2026-01-01')`;
  const both = await newUser('role-twice@example.test');
  await membership(both, 'branch_manager', 'COMPANY', f.company);
  await membership(both, 'branch_manager', 'BRANCH', f.branch);
  // الطلب على دور المالك: حامل دور الفرع بره الطلب مش بيوصل، والمالك الحقيقي هو اللي بيطلع.
  expect(await holders(['owner'])).toEqual([{ userId: f.userId, owner: true }]);
  expect(await holders(['branch_manager'])).toEqual([{ userId: both, owner: false }]);
});
