import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, SYSTEM_ROLES, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';

import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { commissionStatementRecipients } from '../persistence/commission-statement-recipients.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const AT = new Date('2026-06-01T00:00:00.000Z');
const A = TENANT.A;
const READ = 'read:commissions:business';
const REVIEW = 'review:commissions:business';
const APPROVE = 'approve:commissions:business';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

/** دور مخصص بصلاحيات محددة: الدور العالمي بيفرض سياسة، والدور المخصص ما بيفرضش. */
async function customRole(code: string, permissions: readonly string[]): Promise<string> {
  const roleId = ids.newId();
  await owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES(${roleId},${A.company},${code},'Commission reader test role')`;
  for (const permission of permissions) {
    await owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES(${roleId},${A.company},${A.company},${permission})`;
  }
  return roleId;
}

/** مستخدم وعضوية سارية بنطاق. */
async function member(
  label: string,
  roleId: string,
  scope: 'COMPANY' | 'BUSINESS' | 'BRANCH',
  scopeId: string,
  ownerKey: string = A.company,
): Promise<string> {
  const userId = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${userId},${label},${`${userId}@example.test`})`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${A.company},${ids.newId()},${userId},${roleId},${ownerKey},${scope},${scopeId},'2026-01-01T00:00:00Z')`;
  return userId;
}

/** DENY على فرع بعينه. */
async function denyOnBranch(userId: string, membershipId: string, branchId: string): Promise<void> {
  await owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${A.company},${ids.newId()},${membershipId},${READ},'DENY','BRANCH',${branchId},
      'Synthetic test denial',${userId})`;
}

const read = (permission: 'review:commissions:business' | 'approve:commissions:business') =>
  db.withTenant(A.company, (tx) =>
    commissionStatementRecipients(tx, A.company, A.business, permission, AT),
  );

it('CM-58b: only business-wide readers with the action permission are recipients', async () => {
  const both = await customRole('commission_both', [READ, REVIEW, APPROVE]);
  const reviewer = await customRole('commission_reviewer', [READ, REVIEW]);

  // ليلى: صلاحية المراجعة والاعتماد على النشاط، لكن عضويتها على فرع واحد.
  const layla = await member('layla', both, 'BRANCH', A.branch);
  // مدير نشاط بلا DENY: مؤهل.
  const manager = await member('manager', both, 'BUSINESS', A.business);
  // مدير نشاط عليه DENY للقراءة على فرع من فروع النشاط: غير مؤهل.
  const denied = await member('denied', both, 'BUSINESS', A.business);
  const [deniedMembership] = await owner`SELECT id FROM memberships
    WHERE company_id=${A.company} AND user_id=${denied}`;
  await denyOnBranch(denied, deniedMembership?.id as string, A.branch);
  // محاسب عليه DENY للاعتماد: بياخد تذكير المراجعة بس.
  const accountant = await member('accountant', reviewer, 'BUSINESS', A.business);
  const [accountantMembership] = await owner`SELECT id FROM memberships
    WHERE company_id=${A.company} AND user_id=${accountant}`;
  await owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${A.company},${ids.newId()},${accountantMembership?.id as string},${APPROVE},'DENY','BUSINESS',
      ${A.business},'Synthetic test denial',${accountant})`;

  const approvers = await read('approve:commissions:business');
  const reviewers = await read('review:commissions:business');

  expect(approvers).toContain(manager);
  expect(approvers).not.toContain(layla);
  expect(approvers).not.toContain(denied);
  expect(approvers).not.toContain(accountant);

  expect(reviewers).toContain(manager);
  expect(reviewers).toContain(accountant);
  expect(reviewers).not.toContain(layla);
  expect(reviewers).not.toContain(denied);
});

it('CM-58b: the canonical owner receives both notices despite a branch denial', async () => {
  const ownerRoleId = SYSTEM_ROLES.find((role) => role.code === 'owner')?.id ?? '';
  const ownerUser = await member('canonical owner', ownerRoleId, 'COMPANY', A.company, 'global');
  const [ownerMembership] = await owner`SELECT id FROM memberships
    WHERE company_id=${A.company} AND user_id=${ownerUser}`;
  await denyOnBranch(ownerUser, ownerMembership?.id as string, A.branch);

  const approvers = await read('approve:commissions:business');
  const reviewers = await read('review:commissions:business');

  expect(approvers).toContain(ownerUser);
  expect(reviewers).toContain(ownerUser);
});

/** عضو بكل صلاحيات العمولات لكن في الشركة التانية: لازم ما يظهرش في قراءة شركة A. */
async function otherCompanyMember(): Promise<string> {
  const B = TENANT.B;
  const roleId = ids.newId();
  const userId = ids.newId();
  await owner`INSERT INTO roles(id,company_id,code,name_en)
    VALUES(${roleId},${B.company},'commission_both_other',${'Commission reader other company'})`;
  for (const permission of [READ, REVIEW, APPROVE]) {
    await owner`INSERT INTO role_permissions(role_id,role_owner_key,company_id,permission_code)
      VALUES(${roleId},${B.company},${B.company},${permission})`;
  }
  await owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'other company',${`${userId}@example.test`})`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${B.company},${ids.newId()},${userId},${roleId},${B.company},'COMPANY',${B.company},'2026-01-01T00:00:00Z')`;
  return userId;
}

it('CM-58b: another company is never returned', async () => {
  const other = await otherCompanyMember();

  expect(await read('approve:commissions:business')).not.toContain(other);
  expect(await read('review:commissions:business')).not.toContain(other);
});

it('CM-58b: canonical owner parity holds when the owner membership sorts after a denied branch row', async () => {
  const branchRole = await customRole('commission_branch_only', [READ, REVIEW, APPROVE]);
  const ownerRoleId = SYSTEM_ROLES.find((role) => role.code === 'owner')?.id ?? '';
  const userId = ids.newId();
  const branchMembershipId = '01000000-0000-7000-8000-000000000001';
  const ownerMembershipId = '01999999-0000-7000-8000-000000000099';
  await owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'multi-row owner',${`${userId}@example.test`})`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    VALUES(${A.company},${branchMembershipId}::uuid,${userId},${branchRole},${A.company},'BRANCH',${A.branch},'2026-01-01T00:00:00Z'),
          (${A.company},${ownerMembershipId}::uuid,${userId},${ownerRoleId},'global','COMPANY',${A.company},'2026-01-01T00:00:00Z')`;
  await denyOnBranch(userId, branchMembershipId, A.branch);

  expect(await read('approve:commissions:business')).toContain(userId);
  expect(await read('review:commissions:business')).toContain(userId);
});
