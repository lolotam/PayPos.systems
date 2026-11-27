import type { UpdateEmployeeInput } from '@pospay/contracts';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  addEmployee,
  grant,
  nextPhone,
  staffAccessFixture,
  type Fixture,
} from '../../../../test/staff-access.fixture.ts';
import { createEmployeeUpdateTransactions } from '../persistence/drizzle-employee-update.ts';
import { personalBranchReads as reads } from '../persistence/personal-branches.adapter.ts';
import { readPersonalBranches } from '../queries/personal-branches.query.ts';
import { UpdateEmployeeUseCase } from '../use-cases/update-employee/update-employee.usecase.ts';

// نقل الفرع الأساسي للموظفة (080-b): الفرع الجديد بياخد مكان القديم، والفرع الإضافي المدمج
// بيفضل مستقل، والارتباطات بتتقفل بتاريخ-branch وبتبدأ بتاريخ المنح.
const ids = systemUuidV7();
let f: Fixture;
let ownerUserId: string;
let counter = 900;
const invalidated: { membershipId: string }[] = [];

beforeAll(async () => {
  f = await staffAccessFixture({ staffAccessRoutes: true });
  const session = await f.h.auth.getSession(new Headers({ cookie: f.ownerCookie }));
  ownerUserId = session?.userId as string;
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

/** صف دخول الموظفة كما يقرأه الخادم. */
const accessOf = async (employee: string) =>
  (
    await f.h
      .owner`SELECT id, state, branch_id, membership_id, user_id, operation_id FROM employee_staff_access
      WHERE company_id=${f.company} AND employee_id=${employee}`
  )[0];

/** صفوف الفروع الإضافية المحفوظة للسجل. */
const extrasOf = async (employee: string) =>
  f.h.owner`SELECT id, branch_id, role_code, membership_id FROM employee_staff_access_branches
    WHERE company_id=${f.company}
      AND access_id=(SELECT id FROM employee_staff_access WHERE employee_id=${employee}) ORDER BY id`;

/** ارتباطات الموظفة بالفروع وتواريخ بدايتها — بداية المنح مش تاريخ التعيين. */
const attachmentsOf = (employee: string) =>
  f.h.owner`SELECT branch_id, to_char("from",'YYYY-MM-DD') AS from_date, "to",
    to_char("to",'YYYY-MM-DD') AS to_date FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${employee} ORDER BY branch_id, "from"`;

/** تاريخ اليوم في توقيت الفرع — نفس الحساب اللي بيعمله السيرفر. */
const todayInKuwait = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(new Date());

/** تاريخ الغد في توقيت الكويت لاختبار ارتباطات المستقبل. */
const tomorrowInKuwait = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(
    new Date(Date.now() + 24 * 60 * 60 * 1000),
  );

/** ينقل الموظفة لفرع أساسي جديد ويفتح المسار بمدير كاش بيتسجل. */
const updateEmployee = async (employee: string, branchId: string): Promise<void> => {
  const [row] = await f.h
    .owner`SELECT primary_branch_id, name_en, name_ar, role_code, user_id, revision,
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

it('080-b a future-dated branch attachment is bridged from grantDate so today is readable', async () => {
  const sara = await newEmployee('Sara future');
  const tomorrow = tomorrowInKuwait();
  await f.h.owner`INSERT INTO employee_branches
    (company_id, id, business_id, employee_id, branch_id, "from")
    VALUES (${f.company}, ${ids.newId()}, ${f.business}, ${sara}, ${f.hawalli}, ${tomorrow}::date)`;
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
  });
  expect(response.status).toBe(200);
  const hawalliRows = (await attachmentsOf(sara)).filter((row) => row['branch_id'] === f.hawalli);
  expect(hawalliRows).toEqual([
    expect.objectContaining({ from_date: todayInKuwait(), to_date: tomorrow }),
    expect.objectContaining({ from_date: tomorrow, to_date: null }),
  ]);
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

it('080-b moving primary branch onto an extra branch preserves active DENY overrides', async () => {
  const sara = await newEmployee('Sara deny');
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    role: 'reception',
    additional_branches: [{ branch_id: f.hawalli, role: 'reception' }],
    permission_overrides: [
      {
        permission_code: 'create:customers:branch',
        effect: 'DENY',
        scope_type: 'BRANCH',
        scope_id: f.hawalli,
        reason: 'keep customer creation denied after primary transfer',
        expires_at: null,
      },
    ],
  });
  expect(response.status).toBe(200);
  const extraMembership = (await extrasOf(sara))[0]?.['membership_id'] as string;
  await updateEmployee(sara, f.hawalli);
  const movedAccess = await accessOf(sara);
  const endedExtra = await f.h.owner`SELECT ends_at FROM memberships
    WHERE company_id=${f.company} AND id=${extraMembership}`;
  expect(endedExtra[0]?.['ends_at']).not.toBeNull();
  const overrides = await f.h.owner`SELECT permission_code, effect, scope_id
    FROM permission_overrides WHERE company_id=${f.company} AND membership_id=${movedAccess?.['membership_id']}`;
  expect(overrides).toEqual([
    { permission_code: 'create:customers:branch', effect: 'DENY', scope_id: f.hawalli },
  ]);
});
