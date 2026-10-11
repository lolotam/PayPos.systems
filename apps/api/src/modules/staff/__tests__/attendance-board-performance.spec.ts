import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { attendanceBoard, attendanceBoardStatement } from '../queries/attendance-board.query.ts';
import {
  attendanceDeviceRefusals,
  attendanceDeviceRefusalsStatement,
} from '../queries/attendance-device-refusals.query.ts';
import { attendanceBoardFixture, type BoardFixture } from './attendance-board.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: BoardFixture;
beforeAll(async () => {
  f = await attendanceBoardFixture();
  const ids = Array.from({ length: 60 }, () => leaveIds.newId());
  const sessionIds = Array.from({ length: 6200 }, () => leaveIds.newId());
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    SELECT ${f.company},employee_id,${f.business},${f.branch},'Synthetic board employee','synthetic board employee','staff','2026-01-01'
    FROM unnest(${ids}::uuid[]) AS employee_id`;
  await f.h
    .owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,
    clock_in,clock_out,status,source,closed_by,geo,out_geo,late_minutes)
    SELECT ${f.company},session_id,${f.business},${f.branch},(${ids}::uuid[])[((n-1)%60)+1],
      '2026-10-04'::date-((n-1)/200)::int,'Asia/Kuwait',
      '2026-10-04T04:00:00Z'::timestamptz-(((n-1)/200)::int)*interval '1 day'+((n-1)%200)*interval '1 minute',
      '2026-10-04T04:00:00Z'::timestamptz-(((n-1)/200)::int)*interval '1 day'+((n-1)%200)*interval '1 minute'+interval '1 minute',
      'CLOSED','QR','EMPLOYEE','NONE','NONE',0 FROM unnest(${sessionIds}::uuid[]) WITH ORDINALITY AS s(session_id,n)`;
  const refusalIds = Array.from({ length: 200 }, () => leaveIds.newId());
  await f.h
    .owner`INSERT INTO attendance_device_refusals(company_id,id,business_id,branch_id,employee_id,
    installation_hash,step,reason,attempted_at)
    SELECT ${f.company},refusal_id,${f.business},${f.branch},(${ids}::uuid[])[((n-1)%60)+1],repeat('a',64),
      'CLOCK','NOT_ENROLLED','2026-10-04T04:00:00Z'::timestamptz+n*interval '1 minute'
    FROM unnest(${refusalIds}::uuid[]) WITH ORDINALITY AS r(refusal_id,n)`;
  await f.h.owner`ANALYZE attendance_sessions`;
  await f.h.owner`ANALYZE attendance_device_refusals`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('60 employees and 200 daily sessions remain index backed within the polling SQL budget', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const result = await attendanceBoard(tx, f.scope, f.boardClock.now(), '2026-10-04');
    expect(result.sessions).toHaveLength(200);
    expect(new Set(result.sessions.map((row) => row.employee_id)).size).toBe(60);
    const [plan] = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceBoardStatement(f.scope, '2026-10-04')}`,
    );
    expect(JSON.stringify(plan)).toMatch(/attendance_sessions_(board|employee_date)_idx/);
    expect(
      (plan?.['QUERY PLAN'] as { 'Execution Time': number }[])[0]?.['Execution Time'],
    ).toBeLessThan(200);
  });
});
it('the unbounded-date refusals page uses the branch/time keyset index and projects no hash', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const query = { ...f.scope, limit: 50 };
    const page = await attendanceDeviceRefusals(tx, query);
    expect(page.items).toHaveLength(50);
    expect(JSON.stringify(page)).not.toContain('hash');
    const [plan] = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceDeviceRefusalsStatement(query)}`,
    );
    expect(JSON.stringify(plan)).toContain('attendance_device_refusals_branch_time_idx');
    expect(
      (plan?.['QUERY PLAN'] as { 'Execution Time': number }[])[0]?.['Execution Time'],
    ).toBeLessThan(200);
  });
});
