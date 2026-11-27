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
import { personalBranchReads as reads } from '../persistence/personal-branches.adapter.ts';
import { readPersonalBranches } from '../queries/personal-branches.query.ts';

// منح دخول موظفة على أكتر من فرع (080-b): كل فرع زيادة بيتحول لعضوية مستقلة، والفروع الإضافية
// بتتزامن مع ارتباط الموظفة بالفرع، والإيقاف بيقفلها كلها.
const ids = systemUuidV7();
let f: Fixture;
let ownerUserId: string;
let counter = 700;

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
    await f.h
      .owner`SELECT id, state, branch_id, membership_id, user_id, operation_id FROM employee_staff_access
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
  f.h.owner`SELECT branch_id, to_char("from",'YYYY-MM-DD') AS from_date, "to",
    to_char("to",'YYYY-MM-DD') AS to_date FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${employee} ORDER BY branch_id, "from"`;

/** استثناء صلاحية على فرع زيادة: الصلاحية والأثر والنطاق والسبب. */
const overrideOn = (
  permissionCode: string,
  effect: 'ALLOW' | 'DENY',
  reason: string,
): Record<string, unknown> => ({
  permission_code: permissionCode,
  effect,
  scope_type: 'BRANCH',
  scope_id: f.hawalli,
  reason,
  expires_at: null,
});

/** الاستثناءات المحفوظة على عضويات المستخدم. */
const overridesOf = (userId: string) =>
  f.h.owner`SELECT permission_code, effect, scope_id FROM permission_overrides
    WHERE company_id=${f.company} AND membership_id IN (
      SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${userId})`;

/** تاريخ اليوم في توقيت الفرع — نفس الحساب اللي بيعمله السيرفر. */
const todayInKuwait = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuwait' }).format(new Date());

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
    permission_overrides: [overrideOn('read:attendance:branch', 'DENY', 'covering the front desk')],
  });
  expect(response.status).toBe(200);
  const access = await accessOf(sara);
  expect(await overridesOf(access?.['user_id'] as string)).toEqual([
    { permission_code: 'read:attendance:branch', effect: 'DENY', scope_id: f.hawalli },
  ]);
  // تدقيق الاستثناء مقصور على شركة هذه الموظفة وعضوياتها، فمش متعلق بترتيب الصفوف.
  const audits = await f.h.owner`SELECT action FROM audit_log
    WHERE company_id=${f.company} AND entity='permission_override' AND entity_id IN (
      SELECT id FROM permission_overrides WHERE company_id=${f.company} AND membership_id IN (
        SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${access?.['user_id']}))
    ORDER BY action`;
  expect(audits.map((row) => row['action'])).toEqual(['permission.granted']);
});

it('080-b an override with an upper-case scope id is accepted and stored in lower case', async () => {
  const sara = await newEmployee('Sara upper scope');
  const response = await grant(f, sara, nextPhone(f), f.ownerCookie, {
    role: 'reception',
    permission_overrides: [
      {
        permission_code: 'create:customers:branch',
        effect: 'ALLOW',
        scope_type: 'BRANCH',
        scope_id: f.salmiya.toUpperCase(),
        reason: 'customer creation on her own branch',
        expires_at: null,
      },
    ],
  });
  expect(response.status).toBe(200);
  const access = await accessOf(sara);
  expect(await overridesOf(access?.['user_id'] as string)).toEqual([
    { permission_code: 'create:customers:branch', effect: 'ALLOW', scope_id: f.salmiya },
  ]);
});

it('080-b a refused override rolls the whole grant back even after a valid override', async () => {
  const sara = await newEmployee('Sara refused');
  const overridesBefore = await f.h.owner`SELECT id FROM permission_overrides
    WHERE company_id=${f.company}`;
  const phone = nextPhone(f);
  const response = await grant(f, sara, phone, f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
    permission_overrides: [
      overrideOn('read:attendance:branch', 'DENY', 'valid override before failure'),
      overrideOn('read:invented:branch', 'ALLOW', 'not a real permission'),
    ],
  });
  expect(response.status).toBe(403);
  expect(response.body).toMatchObject({ code: 'STAFF_ACCESS_NOT_ALLOWED' });
  const access = await accessOf(sara);
  expect(access).toMatchObject({ state: 'PENDING' });
  const staffUser = (await staffUsersOf(f)).find(
    (user) => user['staff_access_operation_id'] === access?.['operation_id'],
  );
  expect(staffUser).toBeDefined();
  const userId = staffUser?.['id'] as string;
  expect(await membershipsOf(userId)).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM cashier_pins WHERE company_id=${f.company} AND user_id=${userId}`,
  ).toHaveLength(0);
  expect(
    await f.h
      .owner`SELECT id FROM outbox WHERE event_type='StaffAccessGranted' AND aggregate_id=${sara}`,
  ).toHaveLength(0);
  expect((await extrasOf(sara))[0]?.['membership_id']).toBeNull();
  const overridesAfter = await f.h.owner`SELECT id FROM permission_overrides
    WHERE company_id=${f.company}`;
  expect(overridesAfter).toHaveLength(overridesBefore.length);
  expect(await attachmentsOf(sara)).toHaveLength(1);
  // إعادة المحاولة بنفس الهاتف ونفس الفروع الإضافية وبالاستثناء الصحيح بس بتنجح: بصمة
  // المحاولة المرفوضة اتحررت بانتهاءها، فمفيش استثناء قديم بيلزم الطلب الجديد.
  const retry = await grant(f, sara, phone, f.ownerCookie, {
    additional_branches: [{ branch_id: f.hawalli, role: 'staff' }],
    permission_overrides: [
      overrideOn('read:attendance:branch', 'DENY', 'valid override before failure'),
    ],
  });
  expect(retry.status).toBe(200);
  expect(await accessOf(sara)).toMatchObject({ state: 'ACTIVE' });
  expect(await membershipsOf(userId)).toHaveLength(2);
  expect(await overridesOf(userId)).toEqual([
    { permission_code: 'read:attendance:branch', effect: 'DENY', scope_id: f.hawalli },
  ]);
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
