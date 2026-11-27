import type { UpdateEmployeeInput } from '@pospay/contracts';
import { PROVISIONAL_PLAN_ID } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  addEmployee,
  grant,
  grantPath,
  nextPhone,
  staffAccessFixture,
  staffUsersOf,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { createEmployeeUpdateTransactions } from '../persistence/drizzle-employee-update.ts';
import { personalBranchReads as reads } from '../persistence/personal-branches.adapter.ts';
import { readPersonalBranches } from '../queries/personal-branches.query.ts';
import { UpdateEmployeeUseCase } from '../use-cases/update-employee/update-employee.usecase.ts';

// منح دخول موظفة على أكتر من فرع (080-b): كل فرع زيادة بيتحول لعضوية مستقلة، والفروع الإضافية
// بتتزامن مع ارتباط الموظفة بالفرع، والإيقاف بيقفلها كلها.
const ids = systemUuidV7();
let f: Fixture;
let ownerUserId: string;
let counter = 700;
const invalidated: { membershipId: string }[] = [];

beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
  const session = await f.h.auth.getSession(new Headers({ cookie: f.ownerCookie }));
  ownerUserId = session?.userId as string;
  // فروع التوقيت الصريح: تواريخ الفرع في الشاشة الشخصية محسوبة بتوقيت الفرع نفسه.
  await f.h.owner`UPDATE branches SET timezone='Asia/Kuwait' WHERE company_id=${f.company}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

/** موظفة جديدة برقم تسلسلي خاص بكل اختبار. */
const newEmployee = async (name: string): Promise<string> => {
  counter += 1;
  return addEmployee(f, name, f.salmiya, counter);
};

/** فرع من شركة تانية: لازم يرفض قبل أي كتابة. */
const foreignBranch = async (): Promise<string> => {
  const company = ids.newId();
  const business = ids.newId();
  const branch = ids.newId();
  await f.h.owner`INSERT INTO companies (id, name_en, owner_user_id, plan_id)
    VALUES (${company}, 'Foreign employer', ${ownerUserId}, ${PROVISIONAL_PLAN_ID})`;
  await f.h.owner`INSERT INTO businesses (id, company_id, vertical_type, name_en)
    VALUES (${business}, ${company}, 'salon', 'Foreign business')`;
  await f.h.owner`INSERT INTO branches (id, company_id, business_id, name_en)
    VALUES (${branch}, ${company}, ${business}, 'Foreign branch')`;
  return branch;
};

/** صف دخول الموظفة كما يقرأه الخادم. */
const accessOf = async (employee: string) =>
  (
    await f.h.owner`SELECT id, state, branch_id, membership_id, user_id FROM employee_staff_access
      WHERE company_id=${f.company} AND employee_id=${employee}`
  )[0];

/** صفوف الفروع الإضافية المحفوظة للسجل. */
const extrasOf = async (employee: string) =>
  f.h.owner`SELECT id, branch_id, role_code, membership_id FROM employee_staff_access_branches
    WHERE company_id=${f.company}
      AND access_id=(SELECT id FROM employee_staff_access WHERE employee_id=${employee}) ORDER BY id`;

/** عضويات المستخدم الممنوحة. */
const membershipsOf = (userId: string) =>
  f.h.owner`SELECT id, scope_type, scope_id, ends_at FROM memberships
    WHERE company_id=${f.company} AND user_id=${userId} ORDER BY id`;

/** ارتباطات الموظفة بالفروع وتواريخ بدايتها — بداية المنح مش تاريخ التعيين. */
const attachmentsOf = (employee: string) =>
  f.h.owner`SELECT branch_id, to_char("from",'YYYY-MM-DD') AS from_date, "to" FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${employee} ORDER BY branch_id`;

/** تاريخ اليوم في توقيت الفرع — نفس الحساب اللي بيعمله السيرفر. */
const todayInKuwait = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(new Date());

/** ينقل الموظفة لفرع أساسي جديد ويفتح المسار بمدير كاش بيتسجل. */
const updateEmployee = async (employee: string, branchId: string): Promise<void> => {
  const [row] = await f.h.owner`SELECT primary_branch_id, name_en, name_ar, role_code, user_id, revision,
    to_char(hire_date,'YYYY-MM-DD') AS hire_date, to_char(contract_end,'YYYY-MM-DD') AS contract_end
    FROM employees WHERE id=${employee}`;
  const useCase = new UpdateEmployeeUseCase(
    createEmployeeUpdateTransactions(f.db, ids, {
      invalidate: async (input) => {
        invalidated.push({ membershipId: input.membershipId });
      },
    }),
    ids,
  );
  await useCase.execute({
    companyId: f.company,
    userId: ownerUserId,
    businessId: f.business,
    employeeId: employee,
    input: {
      primary_branch_id: branchId,
      name_en: row?.['name_en'],
      name_ar: row?.['name_ar'],
      role_code: row?.['role_code'],
      hire_date: row?.['hire_date'],
      contract_end: row?.['contract_end'],
      user_id: row?.['user_id'],
      expected_revision: row?.['revision'],
      branch_ids: [branchId],
      branch_effective_date: todayInKuwait(),
    } as UpdateEmployeeInput,
  });
};

it('080-b a grant with an extra branch opens both memberships and syncs the branch attachment', async () => {
  const sara = await newEmployee('Sara multi');
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'reception' }],
  });
  expect(response.status).toBe(200);
  const access = await accessOf(sara);
  const extras = await extrasOf(sara);
  expect(extras).toHaveLength(1);
  expect(extras[0]).toMatchObject({ branch_id: f.hawalli, role_code: 'reception' });
  expect(extras[0]?.['membership_id']).not.toBeNull();
  const memberships = await membershipsOf(access?.['user_id'] as string);
  expect(memberships).toHaveLength(2);
  expect(memberships.map((row) => row['scope_id']).sort()).toEqual([f.salmiya, f.hawalli].sort());
  expect(memberships.every((row) => row['ends_at'] === null)).toBe(true);
  const events = await f.h.owner`SELECT payload FROM outbox WHERE event_type='StaffAccessGranted'
    AND aggregate_id=${sara}`;
  expect(events).toHaveLength(2);
  const attachments = await attachmentsOf(sara);
  expect(attachments.map((row) => row['branch_id'])).toEqual([f.hawalli, f.salmiya].sort());
  // تاريخ البدء تاريخ المنح في توقيت الفرع، مش تاريخ التعيين.
  const extraAttachment = attachments.find((row) => row['branch_id'] === f.hawalli);
  expect(extraAttachment?.['from_date']).toBe(todayInKuwait());
  expect(extraAttachment?.['from_date']).not.toBe('2026-01-01');
});

it('080-b the grant writes the created, activated and attachment audits', async () => {
  const nora = await newEmployee('Nora multi');
  await grant(f, nora, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
  });
  const extraId = (await extrasOf(nora))[0]?.['id'] as string;
  const audits = await f.h.owner`SELECT entity, entity_id, action FROM audit_log
    WHERE (entity='employee_staff_access_branch' AND entity_id=${extraId})
       OR (entity='employee_branch' AND entity_id IN (
         SELECT id FROM employee_branches WHERE company_id=${f.company} AND employee_id=${nora}
           AND branch_id=${f.hawalli}))`;
  expect(audits.map((row) => row['action']).sort()).toEqual(['activated', 'created', 'created']);
});

it('080-b the personal branches of the employee list the primary and the extra branch', async () => {
  const sara = await newEmployee('Sara branches');
  await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
  });
  const access = await accessOf(sara);
  const personal = await f.db.withTenant(f.company, (tx) =>
    readPersonalBranches(
      tx,
      {
        companyId: f.company,
        businessId: f.business,
        userId: access?.['user_id'] as string,
        employeeId: sara,
      },
      new Date(),
      reads,
    ),
  );
  expect(personal.items.map((branch) => branch.id).sort()).toEqual([f.salmiya, f.hawalli].sort());
});

it('080-b the primary branch with the same role merges and leaves no extra row', async () => {
  const sara = await newEmployee('Sara merge');
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.salmiya, role: 'staff' }],
  });
  expect(response.status).toBe(200);
  expect(await extrasOf(sara)).toHaveLength(0);
});

it('080-b the primary branch with another role is refused and writes nothing', async () => {
  const sara = await newEmployee('Sara conflict');
  const usersBefore = (await staffUsersOf(f)).length;
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.salmiya, role: 'reception' }],
  });
  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(await accessOf(sara)).toBeUndefined();
  expect((await staffUsersOf(f)).length).toBe(usersBefore);
});

it('080-b a foreign branch is refused and writes nothing', async () => {
  const sara = await newEmployee('Sara foreign');
  const foreign = await foreignBranch();
  const usersBefore = (await staffUsersOf(f)).length;
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: foreign, role: 'staff' }],
  });
  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  expect(await accessOf(sara)).toBeUndefined();
  expect((await staffUsersOf(f)).length).toBe(usersBefore);
});

it('080-b an inline permission override is written with the grant', async () => {
  const sara = await newEmployee('Sara override');
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    permission_overrides: [
      {
        permission_code: 'read:attendance:branch',
        effect: 'DENY',
        scope_type: 'BRANCH',
        scope_id: f.hawalli,
        reason: 'covering the front desk',
        expires_at: null,
      },
    ],
  });
  expect(response.status).toBe(200);
  const access = await accessOf(sara);
  const overrides = await f.h.owner`SELECT permission_code, effect, scope_id FROM permission_overrides
    WHERE company_id=${f.company} AND membership_id IN (
      SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${access?.['user_id']})`;
  expect(overrides).toEqual([
    { permission_code: 'read:attendance:branch', effect: 'DENY', scope_id: f.hawalli },
  ]);
  const audits = await f.h.owner`SELECT action FROM audit_log WHERE entity='permission_override'`;
  expect(audits.map((row) => row['action'])).toEqual(['permission.granted']);
});

it('080-b a refused override rolls the whole grant back', async () => {
  const sara = await newEmployee('Sara refused');
  const overridesBefore = await f.h.owner`SELECT id FROM permission_overrides
    WHERE company_id=${f.company}`;
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
    permission_overrides: [
      {
        permission_code: 'read:invented:branch',
        effect: 'ALLOW',
        scope_type: 'BRANCH',
        scope_id: f.hawalli,
        reason: 'not a real permission',
        expires_at: null,
      },
    ],
  });
  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  const access = await accessOf(sara);
  expect(access).toMatchObject({ state: 'PENDING' });
  expect(await membershipsOf(access?.['user_id'] as string)).toHaveLength(0);
  expect((await extrasOf(sara))[0]?.['membership_id']).toBeNull();
  const overridesAfter = await f.h.owner`SELECT id FROM permission_overrides
    WHERE company_id=${f.company}`;
  expect(overridesAfter).toHaveLength(overridesBefore.length);
  expect(await attachmentsOf(sara)).toHaveLength(1);
});

it('080-b stopping the access ends every membership and clears the extra rows', async () => {
  const sara = await newEmployee('Sara stop');
  await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
  });
  const access = await accessOf(sara);
  const userId = access?.['user_id'] as string;
  const response = await f.h.send('DELETE', grantPath(f, sara), {
    cookie: f.ownerCookie,
    company: f.company,
  });
  expect(response.status).toBe(200);
  const memberships = await membershipsOf(userId);
  expect(memberships).toHaveLength(2);
  expect(memberships.every((row) => row['ends_at'] !== null)).toBe(true);
  const extras = await extrasOf(sara);
  expect(extras).toHaveLength(1);
  expect(extras[0]?.['membership_id']).toBeNull();
  const stopped = await f.h.owner`SELECT entity, action FROM audit_log
    WHERE entity='employee_staff_access_branch' AND action='stopped'`;
  expect(stopped).toHaveLength(1);
  const ended = await f.h.owner`SELECT entity, action FROM audit_log
    WHERE entity='membership' AND action='staff.membership_ended'`;
  expect(ended.length).toBeGreaterThanOrEqual(2);
});

it('080-b moving the primary branch merges the duplicate extra row and ends its membership', async () => {
  const sara = await newEmployee('Sara move');
  await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
  });
  const access = await accessOf(sara);
  const extra = (await extrasOf(sara))[0];
  const extraId = extra?.['id'] as string;
  const extraMembership = extra?.['membership_id'] as string;
  invalidated.length = 0;
  await updateEmployee(sara, f.hawalli);
  expect(await extrasOf(sara)).toHaveLength(0);
  expect(await accessOf(sara)).toMatchObject({ branch_id: f.hawalli });
  const endedExtra = await f.h.owner`SELECT ends_at FROM memberships
    WHERE company_id=${f.company} AND id=${extraMembership}`;
  expect(endedExtra[0]?.['ends_at']).not.toBeNull();
  const audits = await f.h.owner`SELECT entity, action FROM audit_log
    WHERE (entity='employee_staff_access_branch' AND entity_id=${extraId})
       OR (entity='employee_staff_access' AND entity_id=${access?.['id']})`;
  expect(audits.map((row) => row['action'])).toEqual(
    expect.arrayContaining(['branch_moved', 'merged_into_primary']),
  );
  expect(invalidated.map((entry) => entry.membershipId)).toContain(extraMembership);
});
