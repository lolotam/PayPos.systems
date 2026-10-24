import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { ShiftEndingSoonTransactions } from '../ports/shift-ending-soon.port.ts';
import { lockWaiter, type Tenant } from './not-clocked-in.fixture.ts';
import {
  ENDS_SOON_REMIND_AT,
  shiftEndingSoonFixture,
  type ShiftEndingSoonFixture,
} from './shift-ending-soon.fixture.ts';

let f: ShiftEndingSoonFixture;
beforeAll(async () => {
  f = await shiftEndingSoonFixture();
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

/** بصمة الخروج اللي بتقفل State الأول، فالمهمة اللي بعده مابتشوفش جلسة مفتوحة. */
function holdClockOut(
  tenant: Tenant,
  employee: string,
  opened: () => void,
  release: Promise<void>,
) {
  return f.db.withTenant(tenant.company, async (tx) => {
    await tx.execute(sql`SELECT employee_id FROM attendance_states
      WHERE company_id=${tenant.company} AND employee_id=${employee} FOR UPDATE`);
    opened();
    await release;
    await tx.execute(sql`UPDATE attendance_sessions SET status='CLOSED', clock_out=${ENDS_SOON_REMIND_AT},
      closed_by='EMPLOYEE' WHERE company_id=${tenant.company} AND employee_id=${employee} AND status='OPEN'`);
  });
}

function gated(opened: () => void, release: Promise<void>): ShiftEndingSoonTransactions {
  return {
    candidates: f.endsSoonTransactions.candidates,
    rule: f.endsSoonTransactions.rule,
    run: (company, employeeId, sample, work) =>
      f.endsSoonTransactions.run(company, employeeId, sample, async (tx, at) => {
        const result = await work(tx, at);
        opened();
        await release;
        return result;
      }),
  };
}

/** حفظ الأسبوع بيمسح صف الوردية وبيكتبه تاني بمعرف جديد (ADR-0024). */
async function resaveShift(tenant: Tenant, employee: string, shiftId: string, endsAt: Date) {
  const [row] = await f.owner`DELETE FROM staff_schedule_shifts
    WHERE company_id=${tenant.company} AND id=${shiftId}
    RETURNING schedule_id, working_date, day, start, "end", starts_at`;
  await f.owner`INSERT INTO staff_schedule_shifts(company_id,id,schedule_id,employee_id,working_date,day,start,"end",starts_at,ends_at)
    VALUES(${tenant.company},${f.ids.newId()},${row?.['schedule_id']},${employee},${row?.['working_date']},${row?.['day']},
      ${row?.['start']},${row?.['end']},${row?.['starts_at']},${endsAt})`;
}

it('SEN-02 two concurrent workers record one notice', async () => {
  const tenant = await f.tenant();
  const { employee } = await f.atWork(tenant);
  f.setNow(ENDS_SOON_REMIND_AT);
  const [first, second] = await Promise.all([
    f.detectEndsSoon().execute(tenant.company),
    f.detectEndsSoon().execute(tenant.company),
  ]);
  expect(first.notified + second.notified).toBe(1);
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(1);
  expect(await f.endingEvents(tenant.company)).toHaveLength(1);
});

it('SEN-03 a clock-out holding the State lock first wins and the job sends nothing', async () => {
  const tenant = await f.tenant();
  const { employee } = await f.atWork(tenant);
  const locked = gate();
  const release = gate();
  const scan = holdClockOut(tenant, employee, locked.open, release.promise);
  await locked.promise;
  const job = f.detectEndsSoon().execute(tenant.company);
  await lockWaiter(f.owner);
  release.open();
  await scan;
  expect(await job).toEqual({ notified: 0 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(0);
  expect(await f.endingEvents(tenant.company)).toHaveLength(0);
});

it('SEN-03 a clock-out that waits behind the notice does not retract it', async () => {
  const tenant = await f.tenant();
  const { employee } = await f.atWork(tenant);
  const inside = gate();
  const release = gate();
  const job = f.detectEndsSoon(gated(inside.open, release.promise)).execute(tenant.company);
  const settled = job.catch((error: unknown) => error);
  let out: Promise<void> | undefined;
  try {
    await inside.promise;
    out = holdClockOut(tenant, employee, () => undefined, Promise.resolve());
    await lockWaiter(f.owner);
    release.open();
    expect(await settled).toEqual({ notified: 1 });
    await out;
    expect(await f.endingNotices(tenant.company, employee)).toHaveLength(1);
    expect(await f.endingEvents(tenant.company)).toHaveLength(1);
  } finally {
    release.open();
    await settled;
    await out?.catch(() => undefined);
  }
});

it('SEN-07 a re-saved week with the same end never repeats the reminder', async () => {
  const tenant = await f.tenant();
  const { employee, shiftId } = await f.atWork(tenant);
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  await resaveShift(tenant, employee, shiftId, new Date('2026-10-04T15:00:00.000Z'));
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 0 });
  expect(await f.endingNotices(tenant.company, employee)).toHaveLength(1);
  expect(await f.endingEvents(tenant.company)).toHaveLength(1);
});

it('SEN-08 a moved end is a new reminder with the new time', async () => {
  const tenant = await f.tenant();
  const { employee, shiftId } = await f.atWork(tenant);
  f.setNow(ENDS_SOON_REMIND_AT);
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  await resaveShift(tenant, employee, shiftId, new Date('2026-10-04T16:00:00.000Z'));
  f.setNow(new Date('2026-10-04T15:30:00.000Z'));
  expect(await f.detectEndsSoon().execute(tenant.company)).toEqual({ notified: 1 });
  const notices = await f.endingNotices(tenant.company, employee);
  expect(notices).toHaveLength(2);
  expect(new Date(notices[1]?.['shift_ends_at'] as string | Date).toISOString()).toBe(
    '2026-10-04T16:00:00.000Z',
  );
  const events = await f.endingEvents(tenant.company);
  expect(events).toHaveLength(2);
  const payload = events[1]?.['payload'] as {
    notification_recipients: { safe_parameters: { name: string; value: string }[] }[];
  };
  expect(payload.notification_recipients[0]?.safe_parameters[0]).toEqual({
    name: 'shift_end',
    type: 'text',
    value: '19:00',
  });
  expect(f.endsSoonFailures).toEqual([]);
});
