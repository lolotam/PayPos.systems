import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  clockByCardFixture,
  CARD_CODE,
  cardHash,
  unlimitedCardScans,
  type CardFixture,
} from './clock-by-card.fixture.ts';
import { createAttendanceChangeTransactions } from '../persistence/drizzle-attendance-change-transactions.ts';
import { createAttendanceChangeKinds } from '../persistence/attendance-change-kinds.ts';
import { createAddSessionKind } from '../persistence/add-session-kind.ts';
import { createCardClockTransactions } from '../persistence/card-clock-transactions.ts';
import { RequestAttendanceChangeUseCase } from '../use-cases/request-attendance-change/request-attendance-change.usecase.ts';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import { ClockByCard } from '../use-cases/clock-by-card/clock-by-card.ts';

let f: CardFixture;
beforeAll(async () => {
  f = await clockByCardFixture();
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${f.companyId},${f.ids.newId()},${f.viewerId},id,'global','COMPANY',${f.companyId},'2026-01-01'
    FROM roles WHERE code='owner' AND company_id IS NULL`;
});
afterAll(async () => {
  await f?.close();
});
function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const actor = (requestId?: string) => ({
  companyId: f.companyId,
  businessId: f.businessId,
  userId: requestId ? f.viewerId : f.operatorId,
  key: f.ids.newId(),
  fingerprint: 'manual-race',
  ...(requestId ? { requestId } : {}),
});
async function setup(day: string) {
  const kinds = createAttendanceChangeKinds([createAddSessionKind(f.ids)]);
  const tx = createAttendanceChangeTransactions(f.database, f.ids, kinds);
  const clock = { now: () => new Date(`${day}T09:00:00Z`) };
  const row = await new RequestAttendanceChangeUseCase(tx, clock, kinds, f.ids).execute(actor(), {
    kind: 'ADD_SESSION',
    employee_id: f.employeeId,
    branch_id: f.branchId,
    clock_in: `${day}T06:00:00Z`,
    clock_out: `${day}T08:00:00Z`,
    reason: 'synthetic missing day',
  });
  return { tx, kinds, clock, row };
}
async function waiter() {
  await vi.waitFor(
    async () => {
      const rows = await f.owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query LIKE '%attendance_states%' AND pid<>pg_backend_pid()`;
      expect(rows.length).toBeGreaterThan(0);
    },
    { timeout: 3000, interval: 10 },
  );
}

it('AMS-08 scan wins State; approval waits and then refuses the committed OPEN overlap', async () => {
  const { tx, kinds, clock, row } = await setup('2026-10-05');
  f.setNow(new Date('2026-10-05T07:00:00Z'));
  const ready = signal(),
    release = signal();
  const base = createCardClockTransactions(f.database, f.ids, cardHash, f.auth.staff);
  const scanner = new ClockByCard(
    {
      ...base,
      run: (scope, code, sample, work) =>
        base.run(scope, code, sample, async (locked, now) => {
          ready.resolve();
          await release.promise;
          return work(locked, now);
        }),
    },
    f.clock,
    f.ids,
    unlimitedCardScans,
    () => undefined,
  );
  const scanning = scanner.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  await ready.promise;
  const approval = new DecideAttendanceChangeUseCase(tx, clock, kinds).execute(actor(row.id), {
    decision: 'APPROVED',
    revision: 0,
  });
  const outcomes = Promise.allSettled([scanning, approval]);
  try {
    await waiter();
  } finally {
    release.resolve();
  }
  expect(await outcomes).toMatchObject([
    { status: 'fulfilled', value: { operation: 'CLOCK_IN' } },
    { status: 'rejected', reason: { code: 'ATTENDANCE_MANUAL_INVALID_TIMES' } },
  ]);
  expect(
    await f.owner`SELECT status,session_id FROM attendance_change_requests WHERE id=${row.id}`,
  ).toEqual([{ status: 'PENDING', session_id: null }]);
  f.setNow(new Date('2026-10-05T09:00:00Z'));
  await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
});

it('AMS-08 approval wins State; a later scan waits and opens independently of the CLOSED manual day', async () => {
  const { tx, kinds, clock, row } = await setup('2026-10-06');
  const ready = signal(),
    release = signal();
  const decider = new DecideAttendanceChangeUseCase(
    {
      ...tx,
      decide: (who, sample, work) =>
        tx.decide(who, sample, async (scope) => {
          ready.resolve();
          await release.promise;
          return work(scope);
        }),
    },
    clock,
    kinds,
  );
  const approval = decider.execute(actor(row.id), { decision: 'APPROVED', revision: 0 });
  await ready.promise;
  f.setNow(new Date('2026-10-06T09:00:00Z'));
  const scanning = f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  const outcomes = Promise.allSettled([approval, scanning]);
  try {
    await waiter();
  } finally {
    release.resolve();
  }
  expect(await outcomes).toMatchObject([
    { status: 'fulfilled', value: { status: 'APPROVED' } },
    { status: 'fulfilled', value: { operation: 'CLOCK_IN' } },
  ]);
  expect(
    await f.owner`SELECT source,status FROM attendance_sessions WHERE employee_id=${f.employeeId} AND working_date='2026-10-06' ORDER BY clock_in`,
  ).toEqual([
    { source: 'MANUAL', status: 'CLOSED' },
    { source: 'BARCODE', status: 'OPEN' },
  ]);
});
