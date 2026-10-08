import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { H, missedOutFixture, TENANT, type MissedOutFixture } from './missed-out.fixture.ts';
import { missedOutCandidatesStatement } from '../persistence/missed-out.transactions.ts';
import { MISSED_OUT_PAGE_SIZE } from '../use-cases/detect-missed-outs/detect-missed-outs.ts';

let f: MissedOutFixture;
beforeAll(async () => {
  f = await missedOutFixture();
});
afterAll(async () => {
  await f?.close();
});

async function exceptions(sessionId: string) {
  return f.owner`SELECT kind,status,resolution,resolved_by,raised_at,resolved_at FROM attendance_exceptions
    WHERE session_id=${sessionId} ORDER BY id`;
}
async function events(type: string, sessionId: string) {
  return f.owner`SELECT payload FROM outbox WHERE event_type=${type} AND payload->>'session_id'=${sessionId}`;
}

it('raises exactly one suspected exception at shift end + 4 h with audit and event; re-runs change nothing', async () => {
  const A = await f.tenant();
  const clockIn = new Date('2026-10-05T05:00:00Z');
  const employee = await f.employee(A);
  const session = await f.open(A, employee, clockIn, new Date(clockIn.getTime() + 8 * H));
  const young = await f.open(A, await f.employee(A), new Date(clockIn.getTime() + 3 * H));
  f.setNow(new Date(clockIn.getTime() + 12 * H));
  expect(await f.detect().execute(A.company)).toEqual({ suspected: 1, missedOut: 0 });
  expect(await exceptions(session)).toEqual([
    {
      kind: 'SUSPECTED_MISSED_OUT',
      status: 'OPEN',
      resolution: null,
      resolved_by: null,
      raised_at: f.clock.now(),
      resolved_at: null,
    },
  ]);
  expect(await exceptions(young)).toHaveLength(0);
  const [event] = await events('AttendanceExceptionRaised', session);
  expect(event?.['payload']).toMatchObject({
    kind: 'SUSPECTED_MISSED_OUT',
    employee_id: employee,
    business_id: A.business,
    branch_id: A.branch,
    clock_in: clockIn.toISOString(),
    due_at: new Date(clockIn.getTime() + 12 * H).toISOString(),
    raised_at: f.clock.now().toISOString(),
  });
  expect(
    await f.owner`SELECT actor_user_id FROM audit_log WHERE action='suspected_missed_out.raised'
      AND after->>'session_id'=${session}`,
  ).toEqual([{ actor_user_id: null }]);
  f.setNow(new Date(clockIn.getTime() + 13 * H));
  expect(await f.detect().execute(A.company)).toEqual({ suspected: 0, missedOut: 0 });
  expect(await f.detect().execute(A.company)).toEqual({ suspected: 0, missedOut: 0 });
  expect(await exceptions(session)).toHaveLength(1);
  expect(await events('AttendanceExceptionRaised', session)).toHaveLength(1);
  await expect(
    f.owner`INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at)
      VALUES(${A.company},${f.ids.newId()},${A.business},${employee},${A.branch},${session},'SUSPECTED_MISSED_OUT',now())`,
  ).rejects.toMatchObject({ code: '23505' });
});

it('closes MISSED_OUT at the 16-hour instant, resolves the suspected exception and keeps the detection time', async () => {
  const A = await f.tenant();
  const clockIn = new Date('2026-10-06T05:00:00Z');
  const employee = await f.employee(A);
  const session = await f.open(A, employee, clockIn);
  f.setNow(new Date(clockIn.getTime() + 12 * H));
  expect(await f.detect().execute(A.company)).toEqual({ suspected: 1, missedOut: 0 });
  const detected = new Date(clockIn.getTime() + 20 * H);
  f.setNow(detected);
  expect(await f.detect().execute(A.company)).toEqual({ suspected: 0, missedOut: 1 });
  const deadline = new Date(clockIn.getTime() + 16 * H);
  expect(
    await f.owner`SELECT status,closed_by,clock_out,revision FROM attendance_sessions WHERE id=${session}`,
  ).toEqual([{ status: 'MISSED_OUT', closed_by: 'MISSED_OUT', clock_out: deadline, revision: 1 }]);
  expect(await exceptions(session)).toMatchObject([
    { status: 'RESOLVED', resolution: 'MISSED_OUT', resolved_by: null, resolved_at: detected },
  ]);
  expect((await events('AttendanceMissedOut', session))[0]?.['payload']).toEqual({
    session_id: session,
    employee_id: employee,
    business_id: A.business,
    branch_id: A.branch,
    occurred_at: deadline.toISOString(),
    recorded_at: detected.toISOString(),
  });
  expect(
    await f.owner`SELECT actor_user_id FROM audit_log WHERE action='missed_out' AND entity_id=${session}`,
  ).toEqual([{ actor_user_id: null }]);
  expect(
    await f.owner`SELECT last_accepted_scan_at,last_result FROM attendance_states WHERE employee_id=${employee}`,
  ).toEqual([{ last_accepted_scan_at: null, last_result: null }]);
  expect(await f.detect().execute(A.company)).toEqual({ suspected: 0, missedOut: 0 });
  expect(await events('AttendanceMissedOut', session)).toHaveLength(1);
});

it('a due time at the deadline skips the suspected step; no-schedule raises exactly at +12 h', async () => {
  const A = await f.tenant();
  const clockIn = new Date('2026-10-07T05:00:00Z');
  const long = await f.open(A, await f.employee(A), clockIn, new Date(clockIn.getTime() + 12 * H));
  const plain = await f.open(A, await f.employee(A), new Date(clockIn.getTime() + 4 * H));
  f.setNow(new Date(clockIn.getTime() + 16 * H));
  expect(await f.detect().execute(A.company)).toEqual({ suspected: 1, missedOut: 1 });
  expect(await exceptions(long)).toHaveLength(0);
  expect(await f.owner`SELECT status FROM attendance_sessions WHERE id=${long}`).toEqual([
    { status: 'MISSED_OUT' },
  ]);
  expect(await exceptions(plain)).toMatchObject([{ kind: 'SUSPECTED_MISSED_OUT', status: 'OPEN' }]);
});

it('works only inside the scheduled company: another tenant stays untouched and unreadable', async () => {
  const A = TENANT.A,
    B = TENANT.B;
  const clockIn = new Date('2026-10-08T01:00:00Z');
  const other = await f.employee(B);
  const foreign = await f.open(B, other, clockIn);
  f.setNow(new Date(clockIn.getTime() + 13 * H));
  expect(await f.detect().execute(A.company)).toEqual({ suspected: 0, missedOut: 0 });
  expect(await exceptions(foreign)).toHaveLength(0);
  const seen = await f.transactions.run(A.company, other, f.clock.now, async (tx) => tx.open);
  expect(seen).toBeNull();
  const page = await f.transactions.candidates(B.company, f.clock.now(), null, 10);
  expect(page.map((s) => s.id)).toContain(foreign);
  expect(await f.transactions.candidates(A.company, f.clock.now(), null, 1000)).not.toContainEqual(
    expect.objectContaining({ id: foreign }),
  );
  await expect(
    f.db.withTenant(A.company, (tx) =>
      tx.execute(sql`INSERT INTO attendance_exceptions(company_id,id,business_id,employee_id,branch_id,session_id,kind,raised_at)
        VALUES(${B.company},${f.ids.newId()},${B.business},${other},${B.branch},${foreign},'SUSPECTED_MISSED_OUT',now())`),
    ),
  ).rejects.toThrow();
  expect(await f.detect().execute(B.company)).toEqual({ suspected: 1, missedOut: 0 });
});

it('pages through more open sessions than one page and reads them through the one-open index', async () => {
  const A = await f.tenant();
  const clockIn = new Date('2026-10-09T01:00:00Z');
  const count = MISSED_OUT_PAGE_SIZE + 5;
  await f.owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
    SELECT ${A.company}, gen_random_uuid(), ${A.business}, ${A.branch}, 'Synthetic bulk employee', 'staff', '2026-01-01'
    FROM generate_series(1, ${count})`;
  await f.owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes)
    SELECT company_id, gen_random_uuid(), business_id, primary_branch_id, id, '2026-10-09', 'Asia/Kuwait', ${clockIn}, 'OPEN', 'QR', 'OK', 0
    FROM employees WHERE company_id=${A.company} AND name_en='Synthetic bulk employee'`;
  f.setNow(new Date(clockIn.getTime() + 12 * H));
  expect((await f.detect().execute(A.company)).suspected).toBe(count);
  const plan = await f.db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE,FORMAT JSON) ${missedOutCandidatesStatement(A.company, f.clock.now(), { clockIn, id: f.ids.newId() }, 100)}`,
    );
  });
  expect(JSON.stringify(plan)).toContain('attendance_sessions_one_open');
});
