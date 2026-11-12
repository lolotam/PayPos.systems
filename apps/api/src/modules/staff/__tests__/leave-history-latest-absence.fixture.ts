import { sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { historyLastTaken } from '@pospay/db';
import { leaveContext, leaveIds, type LeaveFixture } from './leave-history.fixture.ts';

// Redis مش موضوع الاختبار؛ منع إنشاء client حقيقي يحمي أي خدمة مشتركة في إعداد البيئة.
vi.mock('ioredis', () => ({
  Redis: class {
    async get() {
      return null;
    }
    async set() {
      return 'OK';
    }
    async quit() {
      return 'OK';
    }
    on() {
      return this;
    }
  },
}));

export const latestAsOf = '2026-11-07T10:00:00.000Z';
export const latestVolume = { days: 2_502, schedules: 358, shifts: 2_502 };
export type LatestScenario = 'recent' | 'old' | 'none';
export const latestExpected = { recent: '2026-11-06', old: '2020-01-01', none: null };

export async function latestStatement(f: LeaveFixture, asOf = latestAsOf) {
  return f.db.withTenant(f.company, async (tx) => {
    const scope = await createLeaveReadAccess({ now: () => new Date(asOf) }).check(tx, {
      ...leaveContext(f),
      purpose: 'history',
    });
    if (!scope) throw new Error('LATEST_ABSENCE_SCOPE_MISSING');
    return sql`SELECT ${historyLastTaken(leaveContext(f), scope, asOf)} AS last_taken`;
  });
}

export async function seedLatestYears(f: LeaveFixture) {
  const schedules = Array.from({ length: latestVolume.schedules }, () => leaveIds.newId());
  const shifts = Array.from({ length: latestVolume.shifts }, () => leaveIds.newId());
  await f.h.owner`INSERT INTO staff_schedules
    (company_id,id,business_id,branch_id,employee_id,week_start,timezone,revision)
    SELECT ${f.company},s.id,${f.business},${f.branch},${f.employee.id},
      date '2019-12-28'+((s.n-1)*7)::int,'UTC',1
    FROM unnest(${f.h.owner.array(schedules)}::uuid[]) WITH ORDINALITY s(id,n)`;
  await f.h.owner`INSERT INTO staff_schedule_shifts
    (company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    SELECT ${f.company},s.id,sc.id,${f.employee.id},date '2020-01-01'+(s.n-1)::int,
      (extract(dow FROM date '2020-01-01'+(s.n-1)::int)::int+1)%7,'09:00','17:00',
      timestamptz '2020-01-01T09:00:00Z'+(s.n-1)*interval '1 day',
      timestamptz '2020-01-01T17:00:00Z'+(s.n-1)*interval '1 day'
    FROM unnest(${f.h.owner.array(shifts)}::uuid[]) WITH ORDINALITY s(id,n)
    JOIN staff_schedules sc ON sc.company_id=${f.company} AND sc.employee_id=${f.employee.id}
      AND sc.week_start=(date '2020-01-01'+(s.n-1)::int)
        -((extract(dow FROM date '2020-01-01'+(s.n-1)::int)::int+1)%7)`;
  await f.h.owner`ANALYZE staff_schedules`;
  await f.h.owner`ANALYZE staff_schedule_shifts`;
}

// كل سيناريو بيرجع لحالة مستقلة؛ التغطية في الفرع المخفي تفضل شاملة للنشاط.
export async function restoreLatestScenario(f: LeaveFixture, scenario: LatestScenario) {
  await f.h.owner`DELETE FROM attendance_sessions
    WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  if (scenario !== 'recent') {
    const sessions = Array.from({ length: latestVolume.days }, () => leaveIds.newId());
    await f.h.owner`INSERT INTO attendance_sessions
      (company_id,id,business_id,branch_id,employee_id,working_date,timezone,
       clock_in,clock_out,status,source,closed_by,geo,late_minutes)
      SELECT sh.company_id,s.id,${f.business},${f.secondBranch},sh.employee_id,
        sh.working_date,'UTC',sh.starts_at,sh.ends_at,'CLOSED','QR','EMPLOYEE','NONE',0
      FROM (SELECT id,row_number() OVER (ORDER BY working_date) AS n
        FROM staff_schedule_shifts WHERE company_id=${f.company}
          AND employee_id=${f.employee.id}) numbered
      JOIN unnest(${f.h.owner.array(sessions)}::uuid[]) WITH ORDINALITY s(id,n) USING(n)
      JOIN staff_schedule_shifts sh ON sh.company_id=${f.company} AND sh.id=numbered.id
      WHERE ${scenario}='none' OR sh.working_date>date '2020-01-01'`;
  }
  await f.h.owner`ANALYZE attendance_sessions`;
  const [counts] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM staff_schedules WHERE company_id=${f.company}) AS schedules,
    (SELECT count(*)::int FROM staff_schedule_shifts WHERE company_id=${f.company}) AS shifts,
    (SELECT count(*)::int FROM attendance_sessions WHERE company_id=${f.company}) AS sessions,
    (SELECT count(*)::int FROM leave_requests WHERE company_id=${f.company}) AS leaves,
    (SELECT min(working_date)::text FROM staff_schedule_shifts WHERE company_id=${f.company}) AS first,
    (SELECT max(working_date)::text FROM staff_schedule_shifts WHERE company_id=${f.company}) AS last`;
  return counts;
}

export type ExplainNode = {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  'Actual Rows': number;
  'Actual Loops': number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
  'Sort Space Type'?: string;
  Plans?: ExplainNode[];
};
export function latestPlanNodes(node: ExplainNode): ExplainNode[] {
  return [node, ...(node.Plans ?? []).flatMap(latestPlanNodes)];
}
