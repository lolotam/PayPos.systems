import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { seedEmployee } from '../../test/staff-fixtures.ts';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { SYSTEM_ROLES } from '../access-catalog.ts';
import { ensureEmployeeUserLink, ensureStaffBranchMembership } from '../operator/staging-staff.ts';

const { A, B } = TENANT;
const ids = systemUuidV7();
const operator = 'synthetic.operator';
let testDb: TestDatabase;
let owner: postgres.Sql;
let secondBusiness: string;
let secondBranch: string;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  secondBusiness = ids.newId();
  secondBranch = ids.newId();
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    VALUES (${A.company},${secondBusiness},'Synthetic second business','salon')`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    VALUES (${A.company},${secondBranch},${secondBusiness},'Synthetic second branch')`;
});

afterAll(async () => {
  await owner?.end();
  await testDb?.drop();
});

async function syntheticUser(): Promise<string> {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES (${id},'Synthetic staging',${`${id}@synthetic.invalid`})`;
  return id;
}

function membershipInput(userId: string) {
  return {
    appUrl: testDb.appUrl,
    ids,
    companyId: A.company,
    businessId: A.business,
    branchId: A.branch,
    userId,
    operator,
  };
}

function linkInput(userId: string, employeeId: string) {
  return { ...membershipInput(userId), employeeId };
}

async function syntheticEmployee(companyId: string = A.company): Promise<string> {
  const employeeId = ids.newId();
  await seedEmployee(owner, companyId, employeeId);
  return employeeId;
}

describe('staging staff branch membership', () => {
  it('creates once with a NULL audit actor and then leaves rows and audits unchanged', async () => {
    const userId = await syntheticUser();
    const input = membershipInput(userId);
    expect(await ensureStaffBranchMembership(input)).toBe('created');
    expect(await ensureStaffBranchMembership(input)).toBe('unchanged');
    expect(await owner`SELECT id FROM memberships WHERE company_id=${A.company} AND user_id=${userId}`).toHaveLength(1);
    const audits = await owner`SELECT actor_user_id,action,after FROM audit_log
      WHERE company_id=${A.company} AND entity='membership' AND after->>'user_id'=${userId}`;
    expect(audits).toEqual([
      {
        actor_user_id: null,
        action: 'created',
        after: expect.objectContaining({ operator, user_id: userId, scope_id: A.branch }),
      },
    ]);
  });

  it('does not treat a future or ended membership as active', async () => {
    const staffRole = SYSTEM_ROLES.find((role) => role.code === 'staff')?.id ?? '';
    for (const [startsAt, endsAt] of [
      ['2999-01-01T00:00:00Z', null],
      ['2000-01-01T00:00:00Z', '2001-01-01T00:00:00Z'],
    ] as const) {
      const userId = await syntheticUser();
      await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
        VALUES (${A.company},${ids.newId()},${userId},${staffRole},'global','BRANCH',${A.branch},${startsAt},${endsAt})`;
      expect(await ensureStaffBranchMembership(membershipInput(userId))).toBe('created');
      expect(await owner`SELECT id FROM memberships WHERE company_id=${A.company} AND user_id=${userId}`).toHaveLength(2);
    }
  });

  it('refuses a branch of another business of the same company without writing', async () => {
    const userId = await syntheticUser();
    await expect(
      ensureStaffBranchMembership({ ...membershipInput(userId), branchId: secondBranch }),
    ).rejects.toMatchObject({ code: 'TARGET_SCOPE_REFUSED' });
    expect(await owner`SELECT id FROM memberships WHERE user_id=${userId}`).toHaveLength(0);
    expect(await owner`SELECT id FROM audit_log WHERE after->>'user_id'=${userId}`).toHaveLength(0);
  });

  it.each([
    ['a branch of another business', () => ({ ...membershipInput(''), branchId: secondBranch })],
    [
      'a business of another company',
      () => ({ ...membershipInput(''), businessId: B.business, branchId: B.branch }),
    ],
    ['an unknown company', () => ({ ...membershipInput(''), companyId: ids.newId() })],
  ])('refuses %s without writing', async (_label, makeInput) => {
    const userId = await syntheticUser();
    await expect(ensureStaffBranchMembership({ ...makeInput(), userId })).rejects.toMatchObject({
      code: 'TARGET_SCOPE_REFUSED',
    });
    expect(await owner`SELECT id FROM memberships WHERE user_id=${userId}`).toHaveLength(0);
    expect(await owner`SELECT id FROM audit_log WHERE after->>'user_id'=${userId}`).toHaveLength(0);
  });
});

describe('staging employee user link', () => {
  it('links once with one revision increment and one NULL-actor audit', async () => {
    const userId = await syntheticUser();
    const employeeId = await syntheticEmployee();
    await ensureStaffBranchMembership(membershipInput(userId));
    expect(await ensureEmployeeUserLink(linkInput(userId, employeeId))).toBe('linked');
    expect(await ensureEmployeeUserLink(linkInput(userId, employeeId))).toBe('unchanged');
    expect(
      await owner`SELECT user_id,revision FROM employees WHERE company_id=${A.company} AND id=${employeeId}`,
    ).toEqual([{ user_id: userId, revision: 2 }]);
    const audits = await owner`SELECT actor_user_id,after FROM audit_log
      WHERE company_id=${A.company} AND entity='employee' AND entity_id=${employeeId}`;
    expect(audits).toEqual([
      { actor_user_id: null, after: { operator, employee_id: employeeId, user_id: userId } },
    ]);
  });
});

describe('staging employee user link refusals', () => {
  it('refuses an employee linked to another user without changing it', async () => {
    const userId = await syntheticUser();
    const otherUserId = await syntheticUser();
    const employeeId = await syntheticEmployee();
    await owner`UPDATE employees SET user_id=${otherUserId} WHERE company_id=${A.company} AND id=${employeeId}`;
    await ensureStaffBranchMembership(membershipInput(userId));
    await expect(ensureEmployeeUserLink(linkInput(userId, employeeId))).rejects.toMatchObject({
      code: 'EMPLOYEE_LINKED_TO_ANOTHER_USER',
    });
    expect(
      await owner`SELECT user_id,revision FROM employees WHERE company_id=${A.company} AND id=${employeeId}`,
    ).toEqual([{ user_id: otherUserId, revision: 1 }]);
    expect(await owner`SELECT id FROM audit_log WHERE entity_id=${employeeId}`).toHaveLength(0);
  });

  it('refuses a user with no active membership without writing', async () => {
    const userId = await syntheticUser();
    const employeeId = await syntheticEmployee();
    await expect(ensureEmployeeUserLink(linkInput(userId, employeeId))).rejects.toMatchObject({
      code: 'NO_ACTIVE_MEMBERSHIP',
    });
    expect(
      await owner`SELECT user_id,revision FROM employees WHERE company_id=${A.company} AND id=${employeeId}`,
    ).toEqual([{ user_id: null, revision: 1 }]);
    expect(await owner`SELECT id FROM audit_log WHERE entity_id=${employeeId}`).toHaveLength(0);
  });

  it('refuses a second active employee link for the same user in one business', async () => {
    const userId = await syntheticUser();
    const firstEmployee = await syntheticEmployee();
    const secondEmployee = await syntheticEmployee();
    await owner`UPDATE employees SET user_id=${userId} WHERE company_id=${A.company} AND id=${firstEmployee}`;
    await ensureStaffBranchMembership(membershipInput(userId));
    await expect(ensureEmployeeUserLink(linkInput(userId, secondEmployee))).rejects.toMatchObject({
      code: 'USER_ALREADY_LINKED_IN_BUSINESS',
    });
    expect(
      await owner`SELECT user_id,revision FROM employees WHERE company_id=${A.company} AND id=${secondEmployee}`,
    ).toEqual([{ user_id: null, revision: 1 }]);
    expect(await owner`SELECT id FROM audit_log WHERE entity_id=${secondEmployee}`).toHaveLength(0);
  });

  it('never touches another tenant employee', async () => {
    const userId = await syntheticUser();
    const employeeId = await syntheticEmployee(B.company);
    await ensureStaffBranchMembership(membershipInput(userId));
    await expect(
      ensureEmployeeUserLink({ ...linkInput(userId, employeeId), businessId: B.business }),
    ).rejects.toMatchObject({ code: 'EMPLOYEE_NOT_FOUND' });
    expect(
      await owner`SELECT user_id,revision FROM employees WHERE company_id=${B.company} AND id=${employeeId}`,
    ).toEqual([{ user_id: null, revision: 1 }]);
  });
});
