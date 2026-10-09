import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceFixture,
  enrolPersonal,
  prepareAttendance,
  SYNTHETIC_INSTALLATION,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';
import { sharedInstallations } from '../queries/shared-installations.query.ts';
import { SHARED_INSTALLATION_WINDOW_MS } from '../domain/shared-installation.ts';

const OTHER_INSTALLATION = '87654321-4321-4321-8321-cba987654321';
let f: AttendanceFixture;
let colleague: Awaited<ReturnType<typeof enrolPersonal>>;
beforeAll(async () => {
  f = await attendanceFixture();
  const userId = f.ids.newId(),
    employeeId = f.ids.newId();
  await f.owner`INSERT INTO "user"(id,name,email) VALUES(${userId},'Synthetic colleague','colleague@example.test')`;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.companyId},${employeeId},${f.businessId},${f.branchId},${userId},'Synthetic colleague',${employeeNameMatchKey('Synthetic colleague')},'staff','2026-01-01')`;
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${employeeId},${f.branchId},'2026-01-01')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id)
    SELECT ${f.companyId},${f.ids.newId()},${userId},id,'global','BRANCH',${f.branchId} FROM roles WHERE code='staff' AND company_id IS NULL`;
  colleague = await enrolPersonal(f, userId, employeeId);
});
afterAll(async () => {
  await f?.close();
});

const clockColleague = async (installationId: string) =>
  (
    await prepareAttendance(
      f,
      colleague.scope,
      colleague.device,
      f.challenge,
      f.attendance,
      f.scan(),
      true,
      installationId,
    )
  ).execute();
const flags = (from: Date) =>
  f.database.withTenant(f.companyId, (tx) =>
    sharedInstallations(tx, {
      companyId: f.companyId,
      branches: [{ businessId: f.businessId, branchId: f.branchId }],
      from,
      to: new Date(from.getTime() + 3600000),
      windowMs: SHARED_INSTALLATION_WINDOW_MS,
      limit: 10,
    }),
  );

it('two employees clocking from one installation exactly ten minutes apart are flagged for review, and neither clock is refused', async () => {
  const start = f.clock.now();
  const own = await (await f.prepare()).execute();
  f.setNow(new Date(start.getTime() + SHARED_INSTALLATION_WINDOW_MS));
  const shared = await clockColleague(SYNTHETIC_INSTALLATION);
  expect([own.operation, shared.operation]).toEqual(['CLOCK_IN', 'CLOCK_IN']);
  const page = await flags(new Date(start.getTime() - 1000));
  expect(page.items).toEqual([
    expect.objectContaining({
      first_employee_id: f.employeeId,
      second_employee_id: colleague.scope.employeeId,
      first_clocked_at: own.accepted_at,
      second_clocked_at: shared.accepted_at,
    }),
  ]);
  expect(JSON.stringify(page)).not.toContain(SYNTHETIC_INSTALLATION);
});

it('a different installation, or the same one after the window, is not flagged', async () => {
  const start = new Date(f.clock.now().getTime() + 3 * 3600000);
  f.setNow(start);
  expect((await (await f.prepare(f.scan(), true, OTHER_INSTALLATION)).execute()).operation).toBe(
    'CLOCK_OUT',
  );
  f.setNow(new Date(start.getTime() + 60000));
  expect((await clockColleague(SYNTHETIC_INSTALLATION)).operation).toBe('CLOCK_OUT');
  f.setNow(new Date(start.getTime() + 2 * 60000 + SHARED_INSTALLATION_WINDOW_MS));
  expect((await (await f.prepare()).execute()).operation).toBe('CLOCK_IN');
  expect((await flags(new Date(start.getTime() - 1000))).items).toEqual([]);
});
