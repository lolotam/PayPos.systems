import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  ALERT_AT,
  lockWaiter,
  notClockedInFixture,
  ROLE,
  type NotClockedInFixture,
  type Tenant,
} from './not-clocked-in.fixture.ts';
import type { NotClockedInTransactions } from '../ports/not-clocked-in.port.ts';

let f: NotClockedInFixture;
beforeAll(async () => {
  f = await notClockedInFixture();
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

async function dueEmployee(name: string) {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant, { nameEn: name });
  const shift = await f.shift(tenant, employee);
  f.setNow(ALERT_AT);
  return { tenant, employee, shift };
}

it('NCI-02 two concurrent workers record one notice', async () => {
  const { tenant, employee } = await dueEmployee('Race');
  const [first, second] = await Promise.all([
    f.detect().execute(tenant.company),
    f.detect().execute(tenant.company),
  ]);
  expect(first.notified + second.notified).toBe(1);
  expect(await f.notices(tenant.company, employee)).toHaveLength(1);
  expect(await f.events(tenant.company)).toHaveLength(1);
});

it.each([false, true])('company closure while waiting for State suppresses the notice (manager: %s)', async (hasManager) => {
  const { tenant, employee } = await dueEmployee('Company closes');
  if (hasManager) {
    await f.member({
      tenant, userId: await f.user('manager'), roleId: ROLE.owner,
      scopeType: 'COMPANY', scopeId: tenant.company,
    });
  }
  const locked = gate();
  const release = gate();
  const holder = f.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`SELECT employee_id FROM attendance_states
      WHERE company_id=${tenant.company} AND employee_id=${employee} FOR UPDATE`);
    locked.open();
    await release.promise;
  });
  let job: Promise<unknown> | undefined;
  try {
    await locked.promise;
    job = f.detect().execute(tenant.company).catch((error: unknown) => error);
    await lockWaiter(f.owner);
    await f.closeCompany(tenant.company, ALERT_AT);
    release.open();
    await holder;
    expect(await job).toEqual({ notified: 0 });
    expect(await f.notices(tenant.company, employee)).toHaveLength(0);
    expect(await f.events(tenant.company)).toHaveLength(0);
    expect(await f.owner`SELECT id FROM audit_log WHERE company_id=${tenant.company}`).toHaveLength(0);
  } finally {
    release.open();
    await holder;
    await job;
  }
});

it('NCI-03 a clock-in holding the State lock first wins and the job sends nothing', async () => {
  const { tenant, employee } = await dueEmployee('Clock first');
  const locked = gate();
  const release = gate();
  const scan = holdClockIn(tenant, employee, locked.open, release.promise);
  await locked.promise;
  const job = f.detect().execute(tenant.company);
  await lockWaiter(f.owner);
  release.open();
  await scan;
  expect(await job).toEqual({ notified: 0 });
  expect(await f.notices(tenant.company, employee)).toHaveLength(0);
});

it('NCI-03 a clock-in that waits behind the notice does not retract it', async () => {
  const { tenant, employee } = await dueEmployee('Notice first');
  const inside = gate();
  const release = gate();
  const job = f.detect(gated(inside.open, release.promise)).execute(tenant.company);
  const settled = job.catch((error: unknown) => error);
  let clock: Promise<void> | undefined;
  try {
    await inside.promise;
    clock = holdClockIn(tenant, employee, () => undefined, Promise.resolve());
    await lockWaiter(f.owner);
    release.open();
    expect(await settled).toEqual({ notified: 1 });
    await clock;
    expect(await f.notices(tenant.company, employee)).toHaveLength(1);
    expect(
      await f.owner`SELECT status FROM attendance_sessions WHERE company_id=${tenant.company} AND employee_id=${employee}`,
    ).toEqual([{ status: 'OPEN' }]);
  } finally {
    release.open();
    await settled;
    await clock?.catch(() => undefined);
  }
});

it('NCI-07 waits for a schedule save and skips the deleted shift after commit', async () => {
  const { tenant, employee, shift } = await dueEmployee('Schedule first');
  const deleted = gate();
  const release = gate();
  const save = holdScheduleDelete(tenant, employee, shift, deleted.open, release.promise);
  const settledSave = save.catch((error: unknown) => error);
  let job: Promise<unknown> | undefined;
  try {
    await deleted.promise;
    job = f.detect().execute(tenant.company).catch((error: unknown) => error);
    await employeeLockWaiter('SHARE');
    expect(await f.notices(tenant.company, employee)).toHaveLength(0);
    expect(await f.events(tenant.company)).toHaveLength(0);
    release.open();
    expect(await settledSave).toEqual([{ id: shift }]);
    expect(await job).toEqual({ notified: 0 });
    expect(await f.notices(tenant.company, employee)).toHaveLength(0);
    expect(await f.events(tenant.company)).toHaveLength(0);
  } finally {
    release.open();
    await settledSave;
    await job;
  }
});

it('NCI-07 a schedule save waits for the job locks, then succeeds after the notice commits', async () => {
  const { tenant, employee, shift } = await dueEmployee('Job first');
  const inside = gate();
  const release = gate();
  const transactions: NotClockedInTransactions = {
    candidates: f.transactions.candidates,
    run: (company, employeeId, sample, work) =>
      f.transactions.run(company, employeeId, sample, async (tx, at) => {
        // نوقف المهمة قبل القراءة والكتابة حتى لا يخفي قفل FK الخاص بالتنبيه غياب قفل الموظف.
        inside.open();
        await release.promise;
        return work(tx, at);
      }),
  };
  const job = f.detect(transactions).execute(tenant.company).catch((error: unknown) => error);
  let save: Promise<unknown> | undefined;
  try {
    await inside.promise;
    save = holdScheduleDelete(tenant, employee, shift, () => undefined, Promise.resolve())
      .catch((error: unknown) => error);
    await employeeLockWaiter('UPDATE');
    expect(await f.notices(tenant.company, employee)).toHaveLength(0);
    release.open();
    expect(await job).toEqual({ notified: 1 });
    expect(await save).toEqual([{ id: shift }]);
    expect(await f.owner`SELECT id FROM staff_schedule_shifts
      WHERE company_id=${tenant.company} AND id=${shift}`).toHaveLength(0);
    expect(await f.notices(tenant.company, employee)).toHaveLength(1);
    expect(await f.events(tenant.company)).toHaveLength(1);
  } finally {
    release.open();
    await job;
    await save;
  }
});

async function employeeLockWaiter(mode: 'SHARE' | 'UPDATE') {
  await vi.waitFor(async () => {
    const rows = await f.owner`SELECT pid FROM pg_stat_activity
      WHERE datname=current_database() AND usename='pospay_app' AND wait_event_type='Lock'
        AND query LIKE '%FROM employees%' AND query LIKE ${`%FOR ${mode}%`}`;
    expect(rows).toHaveLength(1);
  }, { timeout: 5_000, interval: 25 });
}

function holdScheduleDelete(
  tenant: Tenant,
  employee: string,
  shift: string,
  opened: () => void,
  release: Promise<void>,
) {
  return f.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`SELECT id FROM employees
      WHERE company_id=${tenant.company} AND id=${employee} FOR UPDATE`);
    const removed = await tx.execute(sql`DELETE FROM staff_schedule_shifts
      WHERE company_id=${tenant.company} AND employee_id=${employee} AND id=${shift} RETURNING id`);
    opened();
    await release;
    return removed;
  });
}

function gated(opened: () => void, release: Promise<void>): NotClockedInTransactions {
  return {
    candidates: f.transactions.candidates,
    run: (company, employeeId, sample, work) =>
      f.transactions.run(company, employeeId, sample, async (tx, at) => {
        const result = await work(tx, at);
        opened();
        await release;
        return result;
      }),
  };
}

function holdClockIn(tenant: Tenant, employee: string, opened: () => void, release: Promise<void>) {
  return f.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`SELECT employee_id FROM attendance_states
      WHERE company_id=${tenant.company} AND employee_id=${employee} FOR UPDATE`);
    opened();
    await release;
    await tx.execute(sql`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes)
      VALUES(${tenant.company},${f.ids.newId()},${tenant.business},${tenant.branch},${employee},'2026-10-04','Asia/Kuwait',${'2026-10-04T07:10:00.000Z'},'OPEN','QR','OK',0)`);
  });
}
