import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { attendanceBoard as contract } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { attendanceBoard, attendanceBoardStatement } from '../queries/attendance-board.query.ts';
import {
  attendanceBoardFixture,
  seedManual,
  seedVoided,
  type BoardFixture,
} from './attendance-board.fixture.ts';
import { seedSession } from './attendance-correction.fixture.ts';
import { openException } from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: BoardFixture;
let open: string;
let overnight: string;
let manual: string;
let manualRequest: string;
let corrected: string;
let hidden: string;
let visibleException: string;
beforeAll(async () => {
  f = await attendanceBoardFixture();
  open = await seedSession(f, {
    workingDate: '2026-10-03',
    clockIn: '2026-10-03T20:00:00Z',
    clockOut: null,
    status: 'OPEN',
    closedBy: null,
    outGeo: null,
    scheduledStart: null,
  });
  overnight = await seedSession(f, {
    clockIn: '2026-10-04T20:00:00Z',
    clockOut: '2026-10-05T03:00:00Z',
    source: 'BARCODE',
  });
  const seededManual = await seedManual(f);
  manual = seededManual.sessionId;
  manualRequest = seededManual.requestId;
  const exception = await openException(f, 'OUT_OF_RANGE');
  visibleException = exception.id;
  corrected = exception.sessionId;
  await f.h
    .owner`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,
    request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
    VALUES(${f.company},${leaveIds.newId()},${f.business},${f.branch},${f.employee.id},${corrected},
      ${leaveIds.newId()},'CLOCK_OUT','2026-10-04T08:50:00Z','2026-10-04T09:00:00Z','synthetic',${f.approverId},'2026-10-04T10:00:00Z')`;
  const voided = await openException(f, 'NONE');
  hidden = voided.sessionId;
  await seedVoided(f, hidden);
  await seedSession(f, { branchId: f.secondBranch });
  await f.h
    .owner`UPDATE employee_branches SET "to"='2026-10-02' WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const board = (date?: string) =>
  f.db.withTenant(f.company, (tx) => attendanceBoard(tx, f.scope, f.boardClock.now(), date));

it('projects exactly the board contract without private employee fields, retaining historical employees', async () => {
  const result = await board('2026-10-04');
  expect(contract.safeParse(result).success).toBe(true);
  expect(Object.keys(result).sort()).toEqual([
    'branch_id',
    'date',
    'generated_at',
    'in_now',
    'sessions',
    'timezone',
  ]);
  expect(result.sessions).toHaveLength(3);
  const manualRow = result.sessions.find((row) => row.id === manual);
  expect(manualRow?.manual).toEqual({
    change_request_id: manualRequest,
    requested_by: f.userId,
    requested_by_name: { ar: f.employee.name_ar, en: f.employee.name_en },
    approved_by: f.approverId,
    approved_by_name: null,
  });
  expect(manualRow?.corrected).toBe(false);
  expect(result.sessions.find((row) => row.id === corrected)?.corrected).toBe(true);
  expect(result.sessions.find((row) => row.id === corrected)?.open_exceptions).toEqual([
    { id: visibleException, kind: 'OUT_OF_RANGE' },
  ]);
  expect(result.sessions.map((row) => row.clock_in)).toEqual(
    result.sessions.map((row) => row.clock_in).sort(),
  );
  const serialized = JSON.stringify(result);
  for (const privateField of ['phone', 'salary', 'iban', 'documents', 'employee_number', 'hours'])
    expect(serialized).not.toContain(privateField);
  expect(serialized).not.toContain(hidden);
});
it('in_now includes every non-voided OPEN session regardless of working date', async () => {
  const today = await board();
  expect(today.date).toBe('2026-10-05');
  expect(today.in_now).toHaveLength(1);
  expect(today.in_now[0]?.clock_in).toBe('2026-10-03T20:00:00.000Z');
  expect(today.sessions).toEqual([]);
  expect((await board('2026-10-03')).sessions.map((row) => row.id)).toEqual([open]);
});
it('overnight sessions belong to their clock-in working date and future dates return empty lists', async () => {
  expect((await board('2026-10-04')).sessions.some((row) => row.id === overnight)).toBe(true);
  expect((await board('2026-10-05')).sessions).toEqual([]);
  expect(await board('2026-10-06')).toMatchObject({ date: '2026-10-06', in_now: [], sessions: [] });
});
it.each([
  [undefined, '2026-10-05'],
  ['2026-10-04', '2026-10-04'],
  ['2026-10-05', '2026-10-05'],
  ['2026-10-06', '2026-10-06'],
])('executes exactly one board statement for requested date %s', async (requestedDate, date) => {
  await f.db.withTenant(f.company, async (tx) => {
    const execute = vi.spyOn(tx, 'execute');
    try {
      const result = await attendanceBoard(tx, f.scope, f.boardClock.now(), requestedDate);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(result.date).toBe(date);
      expect(result.generated_at).toBe(f.boardClock.now().toISOString());
      if (date === '2026-10-06') expect(result).toMatchObject({ in_now: [], sessions: [] });
      else expect(result.in_now).toHaveLength(1);
    } finally {
      execute.mockRestore();
    }
  });
});
it('the same SQL cannot read another company or branch sessions', async () => {
  const rows = await f.db.withTenant(f.otherCompany, (tx) =>
    attendanceBoard(tx, f.scope, f.boardClock.now(), '2026-10-04'),
  );
  expect(rows).toMatchObject({ in_now: [], sessions: [] });
});
it('returns manual provenance using pospay_app without any auth user-name grant', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    const [privilege] = await tx.execute<{ can_read_name: boolean }>(
      sql`SELECT has_column_privilege(current_user,'"user"','name','SELECT') AS can_read_name`,
    );
    expect(privilege?.can_read_name).toBe(false);
    const result = await attendanceBoard(tx, f.scope, f.boardClock.now(), '2026-10-04');
    expect(result.sessions.find((row) => row.id === manual)?.manual).toEqual({
      change_request_id: manualRequest,
      requested_by: f.userId,
      requested_by_name: { ar: f.employee.name_ar, en: f.employee.name_en },
      approved_by: f.approverId,
      approved_by_name: null,
    });
    expect(result.sessions.find((row) => row.id === manual)?.manual?.approved_by_name).toBeNull();
  });
});
it('EXPLAIN ANALYZE uses session/correction indexes and scans exceptions by the primary-key company prefix', async () => {
  await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const plan = await tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${attendanceBoardStatement(f.scope, f.boardClock.now(), '2026-10-04')}`,
    );
    const text = JSON.stringify(plan);
    expect(text).toMatch(/attendance_sessions_(board|employee_date)_idx/);
    expect(text).toContain('attendance_corrections_session_idx');
    expect(text).toContain('attendance_exceptions_company_id_id_pk');
  });
});
