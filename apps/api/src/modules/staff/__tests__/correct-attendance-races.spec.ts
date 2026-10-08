import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import {
  CARD_CODE,
  cardHash,
  clockByCardFixture,
  unlimitedCardScans,
  type CardFixture,
} from './clock-by-card.fixture.ts';
import { createCardClockTransactions } from '../persistence/card-clock-transactions.ts';
import { createAttendanceCorrectionTransactions } from '../persistence/drizzle-attendance-correction-transactions.ts';
import { CorrectAttendanceUseCase } from '../use-cases/correct-attendance/correct-attendance.usecase.ts';
import { ClockByCard } from '../use-cases/clock-by-card/clock-by-card.ts';
import { missedOutTransactions } from '../../../../../worker/src/modules/staff/persistence/missed-out.transactions.ts';
import { DetectMissedOuts } from '../../../../../worker/src/modules/staff/use-cases/detect-missed-outs/detect-missed-outs.ts';

let f: CardFixture;
beforeAll(async () => {
  f = await clockByCardFixture();
});
afterAll(async () => {
  await f?.close();
});
const actor = (sessionId: string) => ({
  companyId: f.companyId,
  businessId: f.businessId,
  userId: f.operatorId,
  sessionId,
  key: f.ids.newId(),
  fingerprint: 'synthetic-correction',
});
const change = (revision: number, clock_out: string) => ({
  revision,
  clock_out,
  reason: 'Synthetic correction',
});
const correct = () =>
  new CorrectAttendanceUseCase(createAttendanceCorrectionTransactions(f.database, f.ids), f.clock);
const scan = () => f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
const at = (value: string) => f.setNow(new Date(value));

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForStateWaiter() {
  await vi.waitFor(
    async () => {
      const rows = await f.owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query LIKE '%attendance_states%' AND pid<>pg_backend_pid()`;
      expect(rows.length).toBeGreaterThan(0);
    },
    { timeout: 3000, interval: 10 },
  );
}

it('CA-09 scan holds State first; correction waits and observes the committed close revision', async () => {
  at('2026-10-05T05:00:00Z');
  const opened = await scan();
  at('2026-10-05T06:00:00Z');
  const ready = signal(),
    release = signal();
  const base = createCardClockTransactions(f.database, f.ids, cardHash, f.auth.staff);
  const held = new ClockByCard(
    {
      ...base,
      run: (scope, code, sample, work) =>
        base.run(scope, code, sample, async (tx, now) => {
          ready.resolve();
          await release.promise;
          return work(tx, now);
        }),
    },
    f.clock,
    f.ids,
    unlimitedCardScans,
    () => undefined,
  );
  const closing = held.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  await ready.promise;
  const correction = correct().execute(actor(opened.session_id), change(0, '2026-10-05T05:30:00Z'));
  const observed = Promise.allSettled([closing, correction]);
  try {
    await waitForStateWaiter();
  } finally {
    release.resolve();
  }
  const results = await observed;
  expect(results[0]).toMatchObject({ status: 'fulfilled', value: { operation: 'CLOCK_OUT' } });
  expect(results[1]).toMatchObject({
    status: 'rejected',
    reason: { code: 'ATTENDANCE_SESSION_REVISION_CONFLICT' },
  });
  expect(
    await f.owner`SELECT revision,status FROM attendance_sessions WHERE id=${opened.session_id}`,
  ).toEqual([{ revision: 1, status: 'CLOSED' }]);
  expect(
    await f.owner`SELECT id FROM attendance_corrections WHERE session_id=${opened.session_id}`,
  ).toHaveLength(0);
});

it('CA-09 correction holds State first; OPEN refusal releases it to the waiting scan', async () => {
  at('2026-10-06T05:00:00Z');
  const opened = await scan();
  at('2026-10-06T06:00:00Z');
  const ready = signal(),
    release = signal();
  const base = createAttendanceCorrectionTransactions(f.database, f.ids);
  const held = new CorrectAttendanceUseCase(
    {
      run: (who, clock, work) =>
        base.run(who, clock, async (scope) => {
          ready.resolve();
          await release.promise;
          return work(scope);
        }),
    },
    f.clock,
  );
  const correction = held.execute(actor(opened.session_id), change(0, '2026-10-06T05:30:00Z'));
  const rejected = correction.catch((error: unknown) => error);
  await ready.promise;
  const closing = scan();
  try {
    await waitForStateWaiter();
  } finally {
    release.resolve();
  }
  expect(await rejected).toMatchObject({ code: 'ATTENDANCE_SESSION_OPEN' });
  expect(await closing).toMatchObject({ operation: 'CLOCK_OUT' });
});

it('CA-08 two real correction transactions contend on State and only the first commits', async () => {
  at('2026-10-07T05:00:00Z');
  const opened = await scan();
  at('2026-10-07T06:00:00Z');
  await scan();
  const ready = signal(),
    release = signal();
  const base = createAttendanceCorrectionTransactions(f.database, f.ids);
  const clock = { now: vi.fn(() => f.clock.now()) };
  const held = new CorrectAttendanceUseCase(
    {
      run: (who, sampled, work) =>
        base.run(who, sampled, async (scope) => {
          ready.resolve();
          await release.promise;
          return work(scope);
        }),
    },
    f.clock,
  );
  const input = change(1, '2026-10-07T05:30:00Z');
  const first = held.execute(actor(opened.session_id), input);
  await ready.promise;
  const second = new CorrectAttendanceUseCase(base, clock).execute(actor(opened.session_id), input);
  const observed = Promise.allSettled([first, second]);
  try {
    await waitForStateWaiter();
    expect(clock.now).toHaveBeenCalledTimes(1);
  } finally {
    release.resolve();
  }
  const results = await observed;
  expect(results[0]).toMatchObject({ status: 'fulfilled' });
  expect(results[1]).toMatchObject({
    status: 'rejected',
    reason: { code: 'ATTENDANCE_SESSION_REVISION_CONFLICT' },
  });
  expect(clock.now).toHaveBeenCalledTimes(2);
  expect(
    await f.owner`SELECT id FROM attendance_corrections WHERE session_id=${opened.session_id}`,
  ).toHaveLength(1);
  expect(
    await f.owner`SELECT id FROM audit_log WHERE entity_id=${opened.session_id} AND action='attendance_session.corrected'`,
  ).toHaveLength(1);
});

it('CA-14 QR close increments revision and repeat scans replay the original result after correction', async () => {
  at('2026-10-08T05:00:00Z');
  const opened = await (await f.prepare()).execute();
  at('2026-10-08T06:00:00Z');
  const closed = await (await f.prepare()).execute();
  expect(closed.operation).toBe('CLOCK_OUT');
  expect(
    await f.owner`SELECT revision FROM attendance_sessions WHERE id=${opened.session_id}`,
  ).toEqual([{ revision: 1 }]);
  const state =
    await f.owner`SELECT last_result,last_accepted_scan_at FROM attendance_states WHERE employee_id=${f.employeeId}`;
  await correct().execute(actor(opened.session_id), change(1, '2026-10-08T05:30:00Z'));
  expect(
    await f.owner`SELECT last_result,last_accepted_scan_at FROM attendance_states WHERE employee_id=${f.employeeId}`,
  ).toEqual(state);
  at('2026-10-08T06:01:00Z');
  expect(await (await f.prepare()).execute()).toEqual(closed);
});

it('CA-14 worker closure increments revision; correction retains MISSED_OUT', async () => {
  at('2026-10-09T05:00:00Z');
  const opened = await scan();
  at('2026-10-09T21:00:00Z');
  const detect = new DetectMissedOuts(missedOutTransactions(f.database, f.ids), f.clock);
  expect(await detect.execute(f.companyId)).toEqual({ missedOut: 1, suspected: 0 });
  expect(
    await f.owner`SELECT revision,status FROM attendance_sessions WHERE id=${opened.session_id}`,
  ).toEqual([{ revision: 1, status: 'MISSED_OUT' }]);
  const result = await correct().execute(
    actor(opened.session_id),
    change(1, '2026-10-09T13:00:00Z'),
  );
  expect(result.session).toMatchObject({
    revision: 2,
    status: 'MISSED_OUT',
    closed_by: 'MISSED_OUT',
  });
});

it('CA-07 refuses the real personal staff session on the correction endpoint', async () => {
  const result = await f.app.inject({
    method: 'POST',
    url: `/v1/businesses/${f.businessId}/attendance-sessions/${f.ids.newId()}/correct`,
    headers: { ...f.headers, 'x-company-id': f.companyId, 'idempotency-key': f.ids.newId() },
    payload: change(0, '2026-10-08T05:30:00Z'),
  });
  expect(result.statusCode).toBe(401);
  expect(result.json().code).toBe('UNAUTHENTICATED');
});
