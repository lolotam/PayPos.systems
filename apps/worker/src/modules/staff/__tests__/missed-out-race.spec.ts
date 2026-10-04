import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  bindPasskey,
  H,
  lockWaiter,
  missedOutFixture,
  scanClose,
  type MissedOutFixture,
} from './missed-out.fixture.ts';
import type { MissedOutTransactions } from '../ports/missed-out.port.ts';

let f: MissedOutFixture;
beforeAll(async () => {
  f = await missedOutFixture();
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

async function suspectedRows(sessionId: string) {
  return f.owner`SELECT status,resolution,resolved_by FROM attendance_exceptions
    WHERE session_id=${sessionId} AND kind='SUSPECTED_MISSED_OUT'`;
}

it('a scan holding the State lock first wins: the job re-checks under the lock and does nothing', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  const binding = await bindPasskey(f, tenant, employee);
  const clockIn = new Date('2026-10-05T05:00:00Z');
  const session = await f.open(tenant, employee, clockIn);
  f.setNow(new Date(clockIn.getTime() + 13 * H));
  const locked = gate(),
    release = gate();
  const scan = scanClose(f, tenant, employee, { id: session, clockIn }, binding, {
    locked: locked.open,
    gate: release.promise,
  });
  await locked.promise;
  const job = f.detect().execute(tenant.company);
  await lockWaiter(f);
  release.open();
  await scan;
  expect(await job).toEqual({ suspected: 0, missedOut: 0 });
  expect(await suspectedRows(session)).toHaveLength(0);
  expect(
    await f.owner`SELECT status,closed_by FROM attendance_sessions WHERE id=${session}`,
  ).toEqual([{ status: 'CLOSED', closed_by: 'EMPLOYEE' }]);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type IN ('AttendanceExceptionRaised','AttendanceMissedOut')
      AND aggregate_id=${employee}`,
  ).toHaveLength(0);
});

it('a scan waiting behind the job closes normally and resolves the raised exception as CLOSED_LATE', async () => {
  const tenant = await f.tenant();
  const employee = await f.employee(tenant);
  const binding = await bindPasskey(f, tenant, employee);
  const clockIn = new Date('2026-10-06T05:00:00Z');
  const session = await f.open(tenant, employee, clockIn, new Date(clockIn.getTime() + 8 * H));
  f.setNow(new Date(clockIn.getTime() + 12 * H + 1));
  const inside = gate(),
    release = gate();
  const gated: MissedOutTransactions = {
    candidates: f.transactions.candidates,
    run: (company, employeeId, sample, work) =>
      f.transactions.run(company, employeeId, sample, async (tx, at) => {
        const result = await work(tx, at);
        inside.open();
        await release.promise;
        return result;
      }),
  };
  const job = f.detect(gated).execute(tenant.company);
  await inside.promise;
  const scan = scanClose(f, tenant, employee, { id: session, clockIn }, binding);
  await lockWaiter(f);
  release.open();
  expect(await job).toEqual({ suspected: 1, missedOut: 0 });
  await scan;
  expect(await suspectedRows(session)).toEqual([
    { status: 'RESOLVED', resolution: 'CLOSED_LATE', resolved_by: f.userId },
  ]);
  expect(
    await f.owner`SELECT status,closed_by FROM attendance_sessions WHERE id=${session}`,
  ).toEqual([{ status: 'CLOSED', closed_by: 'EMPLOYEE' }]);
  f.setNow(new Date(clockIn.getTime() + 17 * H));
  expect(await f.detect().execute(tenant.company)).toEqual({ suspected: 0, missedOut: 0 });
});

it('two concurrent runs for one company raise one exception and close once', async () => {
  const tenant = await f.tenant();
  const clockIn = new Date('2026-10-07T05:00:00Z');
  const suspected = await f.open(tenant, await f.employee(tenant), clockIn);
  const missed = await f.open(
    tenant,
    await f.employee(tenant),
    new Date(clockIn.getTime() - 5 * H),
  );
  f.setNow(new Date(clockIn.getTime() + 12 * H));
  const runs = await Promise.all([
    f.detect().execute(tenant.company),
    f.detect().execute(tenant.company),
  ]);
  expect(runs.reduce((n, r) => n + r.suspected, 0)).toBe(1);
  expect(runs.reduce((n, r) => n + r.missedOut, 0)).toBe(1);
  expect(await suspectedRows(suspected)).toHaveLength(1);
  expect(
    await f.owner`SELECT id FROM outbox WHERE event_type='AttendanceMissedOut' AND payload->>'session_id'=${missed}`,
  ).toHaveLength(1);
});
