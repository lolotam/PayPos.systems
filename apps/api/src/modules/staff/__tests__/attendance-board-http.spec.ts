import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceBoard, attendanceDeviceRefusalPage } from '@pospay/contracts';
import {
  attendanceBoardFixture,
  seedManual,
  type BoardFixture,
} from './attendance-board.fixture.ts';
import { asRole } from './attendance-exception.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';
import { takeTestEmployeeNumber } from '../../../../test/test-employee-number.ts';

let f: BoardFixture;
let manual: Awaited<ReturnType<typeof seedManual>>;
const refusedEmployee = {
  id: leaveIds.newId(),
  name_ar: 'موظفة مرفوضة للاختبار',
  name_en: 'Synthetic refused employee',
};
const holder = {
  id: leaveIds.newId(),
  name_ar: 'حاملة جهاز للاختبار',
  name_en: 'Synthetic device holder',
};
beforeAll(async () => {
  f = await attendanceBoardFixture();
  await seedSession(f, { employeeId: f.employee.id });
  manual = await seedManual(f);
  for (const employee of [refusedEmployee, holder])
    await f.h
      .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_ar,name_en,name_en_key,role_code,hire_date,employee_number)
      VALUES(${f.company},${employee.id},${employee === holder ? f.secondBusiness : f.business},
        ${employee === holder ? f.otherBranch : f.branch},${employee.name_ar},${employee.name_en},
        ${employee.name_en.toLowerCase()},'staff','2026-01-01',${takeTestEmployeeNumber(f.company)})`;
  await f.h
    .owner`INSERT INTO attendance_device_refusals(company_id,id,business_id,branch_id,employee_id,
    holder_employee_id,installation_hash,step,reason,attempted_at) VALUES(${f.company},${leaveIds.newId()},${f.business},${f.branch},
      ${refusedEmployee.id},${holder.id},repeat('a',64),'CLOCK','DEVICE_LOCKED','2026-10-04T12:00:00Z'),
    (${f.company},${leaveIds.newId()},${f.business},${f.branch},${refusedEmployee.id},NULL,repeat('b',64),'CLOCK','NOT_ENROLLED','2026-10-04T12:00:00Z')`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const send = (
  suffix = '',
  branch = f.branch,
  extra = '',
  business = branch === f.otherBranch ? f.secondBusiness : f.business,
) =>
  f.h.send(
    'GET',
    `/v1/businesses/${business}/branches/${branch}/attendance-board${suffix}?${extra.replace(/^&/, '')}`,
    {
      cookie: f.approverCookie,
      company: f.company,
    },
  );

it('the branch manager can read A and gets the same not-found answer for B, unknown and foreign branches', async () => {
  await asRole(f, 'branch_manager');
  const allowed = await send('', f.branch, '&date=2026-10-04');
  expect(allowed.status).toBe(200);
  expect(attendanceBoard.safeParse(allowed.body).success).toBe(true);
  expect(
    attendanceBoard.parse(allowed.body).sessions.find((row) => row.id === manual.sessionId)?.manual,
  ).toEqual({
    change_request_id: manual.requestId,
    requested_by: f.userId,
    requested_by_name: { ar: f.employee.name_ar, en: f.employee.name_en },
    approved_by: f.approverId,
    approved_by_name: null,
  });
  const denied = await send('', f.secondBranch);
  expect(denied.status).toBe(404);
  expect(denied.body.code).toBe('NOT_FOUND');
  for (const branch of [f.foreignBranch, leaveIds.newId()]) {
    const result = await send('', branch);
    expect(result.status).toBe(404);
    expect(result.body).toEqual(denied.body);
  }
  expect((await send('/refusals', f.secondBranch)).status).toBe(404);
});
it.each(['owner', 'general_manager', 'accountant'])(
  '%s reads every company branch',
  async (role) => {
    await asRole(f, role);
    for (const branch of [f.branch, f.secondBranch, f.otherBranch])
      expect((await send('', branch)).status).toBe(200);
  },
);
it('the business manager reads its branches and cannot read a different business', async () => {
  await asRole(f, 'business_manager');
  expect((await send('', f.secondBranch)).status).toBe(200);
  expect((await send('', f.otherBranch)).status).toBe(404);
});
it('a personal DENY defeats the default grant on both endpoints', async () => {
  await asRole(f, 'general_manager');
  const override = leaveIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,
    scope_id,reason,granted_by) VALUES(${f.company},${override},${f.approverMember},'read:attendance:branch','DENY',
    'BRANCH',${f.branch},'synthetic',${f.userId})`;
  try {
    for (const suffix of ['', '/refusals']) expect((await send(suffix)).status).toBe(404);
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${override}`;
  }
});
it('a human without a default can receive a personal ALLOW, restricted to its branch', async () => {
  await asRole(f, 'staff');
  expect((await send()).status).toBe(404);
  const override = leaveIds.newId();
  await f.h
    .owner`INSERT INTO permission_overrides(company_id,id,membership_id,permission_code,effect,scope_type,
    scope_id,reason,granted_by) VALUES(${f.company},${override},${f.approverMember},'read:attendance:branch','ALLOW',
    'BRANCH',${f.branch},'synthetic',${f.userId})`;
  try {
    expect((await send()).status).toBe(200);
    expect((await send('', f.secondBranch)).status).toBe(404);
  } finally {
    await f.h
      .owner`DELETE FROM permission_overrides WHERE company_id=${f.company} AND id=${override}`;
  }
});
it('defaults to branch-local today via the injected clock and returns empty lists for a future date', async () => {
  await asRole(f, 'general_manager');
  const today = await send();
  expect(today.status).toBe(200);
  expect(today.body).toMatchObject({
    date: '2026-10-05',
    timezone: 'Asia/Kuwait',
    generated_at: '2026-10-04T22:30:00.000Z',
  });
  expect((await send('', f.branch, '&date=2026-10-06')).body).toMatchObject({
    in_now: [],
    sessions: [],
  });
});
it.each([undefined, '2026-10-04', '2026-10-05', '2026-10-06'])(
  'executes exactly one board statement per HTTP request with date %s',
  async (date) => {
    await asRole(f, 'general_manager');
    const start = f.h.calls.statements.length;
    const result = await send('', f.branch, date === undefined ? '' : `&date=${date}`);
    expect(result.status).toBe(200);
    expect(result.body.date).toBe(date ?? '2026-10-05');
    const statements = f.h.calls.statements.slice(start);
    expect(statements.filter(({ sql }) => /\bFROM attendance_sessions\b/.test(sql))).toHaveLength(
      1,
    );
    expect(statements.some(({ sql }) => /^SELECT\s+to_char\(/.test(sql))).toBe(false);
    if (date === '2026-10-06') expect(result.body).toMatchObject({ in_now: [], sessions: [] });
  },
);
it('refusals resolves a holder in another business of the same company and paginates without hashes or phones', async () => {
  const first = await send('/refusals', f.branch, '&limit=1');
  expect(first.status).toBe(200);
  const page = attendanceDeviceRefusalPage.parse(first.body);
  expect(page.items).toHaveLength(1);
  expect(first.text).not.toContain('hash');
  expect(first.text).not.toContain('phone');
  const second = attendanceDeviceRefusalPage.parse(
    (
      await send(
        '/refusals',
        f.branch,
        `&limit=1&cursor=${encodeURIComponent(page.next_cursor ?? '')}`,
      )
    ).body,
  );
  expect(second.items).toHaveLength(1);
  expect(second.items[0]?.id).not.toBe(page.items[0]?.id);
  expect(second.next_cursor).toBeNull();
  const items = [...page.items, ...second.items];
  expect(items.every((row) => row.employee_id === refusedEmployee.id)).toBe(true);
  for (const row of items) expect(row.employee).toEqual(refusedEmployee);
  expect(items.find((row) => row.holder_employee_id === holder.id)).toMatchObject({
    holder_employee_id: holder.id,
    holder,
  });
  expect(items.find((row) => row.holder_employee_id === null)?.holder).toBeNull();
  const board = attendanceBoard.parse((await send('', f.branch, '&date=2026-10-04')).body);
  expect(
    board.sessions.some(
      (row) => row.employee_id === refusedEmployee.id || row.employee_id === holder.id,
    ),
  ).toBe(false);
});
it('FEATURE_DISABLED is consistent for both board endpoints after authorized branch scope', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'synthetic',${f.userId})`;
  try {
    for (const suffix of ['', '/refusals']) {
      const result = await send(suffix);
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('FEATURE_DISABLED');
    }
  } finally {
    await f.h
      .owner`DELETE FROM company_feature_overrides WHERE company_id=${f.company} AND flag='staff'`;
  }
});
it('mismatched business paths and malformed branch ids disclose no branch', async () => {
  await asRole(f, 'owner');
  for (const suffix of ['', '/refusals']) {
    for (const business of [f.secondBusiness, f.secondBusiness.toUpperCase(), leaveIds.newId()]) {
      const result = await send(suffix, f.branch.toUpperCase(), '', business);
      expect(result.status).toBe(404);
      expect(result.body.code).toBe('NOT_FOUND');
    }
    expect((await send(suffix, 'invalid')).status).toBe(404);
  }
});
it('malformed dates, cursors, limits and obsolete branch query fields use the validation envelope', async () => {
  for (const [suffix, branch, extra] of [
    ['', f.branch, '&date=2026-02-30'],
    ['', f.branch, `&branch_id=${f.branch}`],
    ['/refusals', f.branch, `&branch_id=${f.branch}`],
    ['/refusals', f.branch, '&cursor=invalid'],
    ['/refusals', f.branch, '&limit=101'],
  ]) {
    const result = await send(suffix, branch, extra);
    expect(result.status).toBe(400);
    expect(result.body.code).toBe('VALIDATION_FAILED');
  }
});
it.each(['business', 'branch', 'both', 'mixed'])(
  'upper-case business and branch ids (%s) read the same branch on both endpoints',
  async (casing) => {
    await asRole(f, 'branch_manager');
    const mixed = (value: string) => value.replace(/[a-c]/g, (letter) => letter.toUpperCase());
    const business =
      casing === 'mixed'
        ? mixed(f.business)
        : casing === 'branch'
          ? f.business
          : f.business.toUpperCase();
    const branch =
      casing === 'mixed'
        ? mixed(f.branch)
        : casing === 'business'
          ? f.branch
          : f.branch.toUpperCase();
    for (const suffix of ['', '/refusals']) {
      const extra = suffix ? '' : '&date=2026-10-04';
      const canonical = await send(suffix, f.branch, extra);
      const result = await send(suffix, branch, extra, business);
      expect(canonical.status).toBe(200);
      expect(result.status).toBe(200);
      expect(result.body).toEqual(canonical.body);
      if (suffix) {
        const page = attendanceDeviceRefusalPage.parse(result.body);
        expect(page.items).toHaveLength(2);
        expect(page.items.every((row) => row.branch_id === f.branch)).toBe(true);
      } else {
        const board = attendanceBoard.parse(result.body);
        expect(board.branch_id).toBe(f.branch);
        expect(board.sessions).toHaveLength(2);
      }
      const denied = await send(suffix, f.secondBranch.toUpperCase(), '', business);
      expect(denied.status).toBe(404);
      expect(denied.body.code).toBe('NOT_FOUND');
    }
  },
);
