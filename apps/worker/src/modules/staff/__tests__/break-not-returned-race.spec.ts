import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { createLogger } from '@pospay/observability';
import { notClockedInDiagnostics } from '../persistence/not-clocked-in-diagnostics.ts';
import type { BreakNotReturnedTransactions } from '../ports/break-not-returned.port.ts';
import { lockWaiter, type Tenant } from './not-clocked-in.fixture.ts';
import {
  BREAK_ALERT_AT,
  BREAK_END,
  BREAK_OUT,
  MORNING_IN,
  breakNotReturnedFixture,
  type BreakNotReturnedFixture,
} from './break-not-returned.fixture.ts';

let f: BreakNotReturnedFixture;
beforeAll(async () => {
  f = await breakNotReturnedFixture();
});
afterAll(async () => {
  await f?.close();
});

function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

async function onBreak() {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: 'Sara' });
  const shift = await f.breakShift(tenant, employee);
  await f.session(tenant, employee, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  f.setNow(BREAK_ALERT_AT);
  return { tenant, employee, shift };
}

function holdReturn(tenant: Tenant, employee: string, opened: () => void, release: Promise<void>) {
  return f.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`SELECT employee_id FROM attendance_states
      WHERE company_id=${tenant.company} AND employee_id=${employee} FOR UPDATE`);
    opened();
    await release;
    await tx.execute(sql`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes)
      VALUES(${tenant.company},${f.ids.newId()},${tenant.business},${tenant.branch},${employee},'2026-10-04','Asia/Kuwait',
        ${new Date(BREAK_END.getTime() + 5 * 60_000).toISOString()},'OPEN','QR','OK',0)`);
  });
}

function gated(opened: () => void, release: Promise<void>): BreakNotReturnedTransactions {
  return {
    candidates: f.breakTransactions.candidates,
    run: (company, employeeId, sample, work) =>
      f.breakTransactions.run(company, employeeId, sample, async (tx, at) => {
        const result = await work(tx, at);
        opened();
        await release;
        return result;
      }),
  };
}

it('a return clock-in holding the State lock first wins and the job sends nothing', async () => {
  const { tenant, employee } = await onBreak();
  const locked = gate();
  const release = gate();
  const scan = holdReturn(tenant, employee, locked.open, release.promise);
  await locked.promise;
  const job = f.detectBreak().execute(tenant.company);
  await lockWaiter(f.owner);
  release.open();
  await scan;
  expect(await job).toEqual({ notified: 0 });
  expect(await f.breakNotices(tenant.company, employee)).toHaveLength(0);
  expect(await f.breakEvents(tenant.company)).toHaveLength(0);
});

it('a return clock-in that waits behind the notice does not retract it', async () => {
  const { tenant, employee } = await onBreak();
  const inside = gate();
  const release = gate();
  const job = f.detectBreak(gated(inside.open, release.promise)).execute(tenant.company);
  const settled = job.catch((error: unknown) => error);
  let back: Promise<void> | undefined;
  try {
    await inside.promise;
    back = holdReturn(tenant, employee, () => undefined, Promise.resolve());
    await lockWaiter(f.owner);
    release.open();
    expect(await settled).toEqual({ notified: 1 });
    await back;
    expect(await f.breakNotices(tenant.company, employee)).toHaveLength(1);
    expect(await f.breakEvents(tenant.company)).toHaveLength(1);
  } finally {
    release.open();
    await settled;
    await back?.catch(() => undefined);
  }
});

it('waits for a schedule save that removes the break and raises nothing after it commits', async () => {
  const { tenant, employee, shift } = await onBreak();
  const saved = gate();
  const release = gate();
  const save = f.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`SELECT id FROM employees WHERE company_id=${tenant.company} AND id=${employee} FOR UPDATE`);
    // حفظ الأسبوع بيمسح الصفوف ويكتبها تاني (ADR-0024)؛ هنا من غير بريك.
    const [row] = await tx.execute<Record<string, unknown>>(sql`DELETE FROM staff_schedule_shifts
      WHERE company_id=${tenant.company} AND id=${shift}
      RETURNING schedule_id, working_date, day, start, "end", starts_at, ends_at`);
    await tx.execute(sql`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
      VALUES(${tenant.company},${f.ids.newId()},${row?.['schedule_id']},${employee},${row?.['working_date']},${row?.['day']},
        ${row?.['start']},${row?.['end']},${row?.['starts_at']},${row?.['ends_at']})`);
    saved.open();
    await release.promise;
  }).catch((error: unknown) => error);
  let job: Promise<unknown> | undefined;
  try {
    await saved.promise;
    job = f.detectBreak().execute(tenant.company).catch((error: unknown) => error);
    await vi.waitFor(async () => {
      const rows = await f.owner`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND usename='pospay_app' AND wait_event_type='Lock'
          AND query LIKE '%FROM employees%' AND query LIKE '%FOR SHARE%'`;
      expect(rows).toHaveLength(1);
    }, { timeout: 5_000, interval: 25 });
    release.open();
    await save;
    expect(await job).toEqual({ notified: 0 });
    expect(await f.breakNotices(tenant.company, employee)).toHaveLength(0);
  } finally {
    release.open();
    await save;
    await job;
  }
});

it('a failure after the notice insert rolls back notice, audit and outbox; the retry records exactly one', async () => {
  const { tenant, employee } = await onBreak();
  const failing: BreakNotReturnedTransactions = {
    candidates: f.breakTransactions.candidates,
    run: (company, employeeId, sample, work) =>
      f.breakTransactions.run(company, employeeId, sample, async (tx, at) => {
        expect(await work(tx, at)).toBe(true);
        throw new Error('synthetic failure after insert');
      }),
  };
  const before = f.breakFailures.length;
  await expect(f.detectBreak(failing).execute(tenant.company)).rejects.toThrow(
    'ATTENDANCE_BREAK_NOT_RETURNED_RETRY',
  );
  expect(f.breakFailures.length).toBe(before + 1);
  expect(await f.breakNotices(tenant.company, employee)).toHaveLength(0);
  expect(await f.breakEvents(tenant.company)).toHaveLength(0);
  expect(await f.owner`SELECT id FROM audit_log WHERE company_id=${tenant.company}
    AND action='break_not_returned.detected'`).toHaveLength(0);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.breakNotices(tenant.company, employee)).toHaveLength(1);
  expect(await f.breakEvents(tenant.company)).toHaveLength(1);
  expect(await f.owner`SELECT id FROM audit_log WHERE company_id=${tenant.company}
    AND action='break_not_returned.detected'`).toHaveLength(1);
});

it('logs break failures under their own code without messages or PII', () => {
  let output = '';
  const logger = createLogger('error', { destination: { write: (line) => { output += line; } } });
  notClockedInDiagnostics(logger, 'ATTENDANCE_BREAK_NOT_RETURNED_RETRY').failed(
    '01920000-0000-7000-8000-000000000001',
    new Error('private synthetic query'),
  );
  expect(JSON.parse(output)).toMatchObject({
    code: 'ATTENDANCE_BREAK_NOT_RETURNED_RETRY', failure: { type: 'Error' },
  });
  expect(output).not.toMatch(/private|synthetic/);
});
