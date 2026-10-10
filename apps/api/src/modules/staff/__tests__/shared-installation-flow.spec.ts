import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceFixture,
  enrolPersonal,
  prepareAttendance,
  SYNTHETIC_INSTALLATION,
  type AttendanceFixture,
} from './clock-attendance.fixture.ts';

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
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${f.companyId},${f.ids.newId()},${userId},id,'global','BRANCH',${f.branchId},'2026-01-01'::timestamptz FROM roles WHERE code='staff' AND company_id IS NULL`;
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
it('accepted clocks retain observations while a shared phone refusal writes none', async () => {
  const own = await (await f.prepare()).execute();
  await expect(clockColleague(SYNTHETIC_INSTALLATION)).rejects.toMatchObject({
    code: 'ATTENDANCE_DEVICE_LOCKED',
  });
  const other = await clockColleague(OTHER_INSTALLATION);
  expect([own.operation, other.operation]).toEqual(['CLOCK_IN', 'CLOCK_IN']);
  const rows =
    await f.owner`SELECT employee_id FROM attendance_device_signals ORDER BY employee_id`;
  expect(rows.map((row) => row['employee_id']).sort()).toEqual(
    [f.employeeId, colleague.scope.employeeId].sort(),
  );
});
