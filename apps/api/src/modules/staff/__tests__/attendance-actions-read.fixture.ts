import {
  attendanceBoardFixture,
  seedVoided,
  type BoardFixture,
} from './attendance-board.fixture.ts';
import { openException } from './attendance-exception.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

export async function actorEmployee(
  f: BoardFixture,
  userId = f.approverId,
  businessId = f.secondBusiness,
) {
  const id = leaveIds.newId();
  const name = { ar: 'اسم اصطناعي', en: 'Synthetic actor' };
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_ar,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.company},${id},${businessId},${businessId === f.business ? f.branch : f.otherBranch},${userId},
      ${name.ar},${name.en},'synthetic actor','staff','2026-01-01')`;
  return { id, name };
}
export async function seedCorrection(
  f: BoardFixture,
  sessionId: string,
  at: string,
  userId = f.approverId,
) {
  const id = leaveIds.newId();
  await f.h
    .owner`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,
    request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
    VALUES(${f.company},${id},${f.business},${f.branch},${f.employee.id},${sessionId},${leaveIds.newId()},
      'CLOCK_OUT','2026-10-04T08:00:00Z','2026-10-04T09:00:00Z','synthetic reason',${userId},${at})`;
  return id;
}
export async function attendanceActionsReadFixture() {
  const f = await attendanceBoardFixture();
  const visible = await openException(f, 'NONE');
  const second = await openException(f, 'OUT_OF_RANGE');
  const hidden = await openException(f, 'NONE');
  await seedVoided(f, hidden.sessionId);
  const resolved = await openException(f, 'OUT_OF_RANGE');
  await f.h.owner`UPDATE attendance_exceptions SET status='RESOLVED',resolution='ACKNOWLEDGED',
    resolved_by=${f.approverId},resolved_at='2026-10-04T10:00:00Z',reason='synthetic',revision=1
    WHERE company_id=${f.company} AND id=${resolved.id}`;
  const otherBranch = await seedSession(f, { employeeId: f.employee.id, branchId: f.secondBranch });
  const empty = await seedSession(f, { employeeId: f.employee.id });
  const actor = await actorEmployee(f);
  const corrections = [
    await seedCorrection(f, hidden.sessionId, '2026-10-04T11:00:00Z'),
    await seedCorrection(f, hidden.sessionId, '2026-10-04T10:00:00Z', f.userId),
    await seedCorrection(f, hidden.sessionId, '2026-10-04T11:00:00Z'),
  ];
  const foreign = await foreignSession(f);
  return {
    ...f,
    visible,
    second,
    hidden,
    resolved,
    otherBranchSession: otherBranch,
    empty,
    actor,
    corrections,
    foreign,
  };
}
async function foreignSession(f: BoardFixture) {
  const [branch] = await f.h
    .owner`SELECT business_id FROM branches WHERE company_id=${f.otherCompany} AND id=${f.foreignBranch}`;
  const businessId = branch?.business_id as string;
  const employee = leaveIds.newId();
  const session = leaveIds.newId();
  const exception = leaveIds.newId();
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,user_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.otherCompany},${employee},${businessId},${f.foreignBranch},${f.approverId},'Foreign actor','foreign actor','staff','2026-01-01')`;
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,out_geo,late_minutes)
    VALUES(${f.otherCompany},${session},${businessId},${f.foreignBranch},${employee},'2026-10-04','Asia/Kuwait',
      '2026-10-04T08:00:00Z','2026-10-04T09:00:00Z','CLOSED','QR','EMPLOYEE','NONE','NONE',0)`;
  await f.h
    .owner`INSERT INTO attendance_exceptions(company_id,id,business_id,branch_id,employee_id,session_id,kind,raised_at)
    VALUES(${f.otherCompany},${exception},${businessId},${f.foreignBranch},${employee},${session},'NONE','2026-10-04T08:00:00Z')`;
  return { businessId, session, exception };
}
export type ActionsReadFixture = Awaited<ReturnType<typeof attendanceActionsReadFixture>>;

export async function seedActionHistory(f: ActionsReadFixture) {
  const ids = Array.from({ length: 8000 }, () => leaveIds.newId());
  const exceptionIds = ids.map(() => leaveIds.newId());
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,out_geo,late_minutes)
    SELECT ${f.company},id,${f.business},${f.branch},${f.employee.id},'2026-01-01','Asia/Kuwait',
      '2026-01-01T05:00:00Z','2026-01-01T08:00:00Z','CLOSED','QR','EMPLOYEE','NONE','NONE',0
    FROM unnest(${ids}::uuid[]) AS id`;
  await f.h
    .owner`INSERT INTO attendance_exceptions(company_id,id,business_id,branch_id,employee_id,session_id,
    kind,status,raised_at,resolution,resolved_at)
    SELECT ${f.company},exception_id,${f.business},${f.branch},${f.employee.id},session_id,'NONE',
      CASE WHEN n<=6000 THEN 'RESOLVED' ELSE 'OPEN' END,'2026-01-01T05:00:00Z',
      CASE WHEN n<=6000 THEN 'ACKNOWLEDGED' ELSE NULL END,
      CASE WHEN n<=6000 THEN '2026-01-01T09:00:00Z'::timestamptz ELSE NULL END
    FROM unnest(${exceptionIds}::uuid[],${ids}::uuid[]) WITH ORDINALITY AS rows(exception_id,session_id,n)`;
  await f.h.owner`ANALYZE attendance_sessions`;
  await f.h.owner`ANALYZE attendance_exceptions`;
}
