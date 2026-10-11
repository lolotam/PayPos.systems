import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { asRole } from './attendance-exception.fixture.ts';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeAudits,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it.each(['cancel', 'approve'])(
  'ACR-06 serializes approval versus %s on State; exactly one commits',
  async (action) => {
    const row = await f.fileChange.execute(changeActor(f), changeInput(f));
    let locked!: () => void, release!: () => void;
    const ready = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstUseCase = new DecideAttendanceChangeUseCase(
      {
        ...f.tx,
        decide: (actor, clock, work) =>
          f.tx.decide(actor, clock, async (scope) => {
            locked();
            await held;
            return work(scope);
          }),
      },
      f.clock,
      f.kinds,
    );
    const first = firstUseCase.execute(changeActor(f, row.id, f.owner), {
      decision: 'APPROVED',
      revision: 0,
    });
    await ready;
    const second =
      action === 'cancel'
        ? f.cancelChange.execute(changeActor(f, row.id), { revision: 0 })
        : f.decideChange.execute(changeActor(f, row.id, f.owner), {
            decision: 'APPROVED',
            revision: 0,
          });
    const outcomes = Promise.allSettled([first, second]);
    try {
      await vi.waitFor(
        async () => {
          const waiters = await f.h
            .owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%attendance_states%' AND pid<>pg_backend_pid()`;
          expect(waiters.length).toBeGreaterThan(0);
        },
        { timeout: 3000 },
      );
    } finally {
      release();
    }
    expect(await outcomes).toMatchObject([
      { status: 'fulfilled' },
      { status: 'rejected', reason: { code: 'ATTENDANCE_CHANGE_NOT_PENDING' } },
    ]);
    expect(await changeAudits(f, row.id)).toHaveLength(2);
  },
);

it('re-samples the clock after State and refuses an owner membership that expired while waiting', async () => {
  const row = await f.fileChange.execute(changeActor(f), changeInput(f));
  await asRole(f, 'owner');
  await f.h
    .owner`UPDATE memberships SET ends_at='2026-10-04T10:01:00Z' WHERE company_id=${f.company} AND user_id=${f.owner}`;
  let now = f.clock.now();
  let locked!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const blockingConnection = postgres(f.h.urls.owner, { max: 1 });
  const blocker = blockingConnection.begin(async (tx) => {
    await tx`SELECT id FROM attendance_states WHERE company_id=${f.company} AND employee_id=${f.employee.id} FOR UPDATE`;
    locked();
    await held;
  });
  await ready;
  const clock = { now: vi.fn(() => now) };
  const useCase = new DecideAttendanceChangeUseCase(f.tx, clock, f.kinds);
  const decision = useCase.execute(changeActor(f, row.id, f.owner), {
    decision: 'APPROVED',
    revision: 0,
  });
  const outcome = decision.catch((error: unknown) => error);
  try {
    await vi.waitFor(
      async () => {
        const waiters = await f.h
          .owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%attendance_states%' AND pid<>pg_backend_pid()`;
        expect(waiters.length).toBeGreaterThan(0);
      },
      { timeout: 3000 },
    );
    now = new Date('2026-10-04T10:02:00Z');
  } finally {
    release();
  }
  await blocker;
  await blockingConnection.end();
  try {
    expect(await outcome).toMatchObject({ code: 'NOT_FOUND' });
    expect(clock.now).toHaveBeenCalledTimes(2);
    expect(await changeAudits(f, row.id)).toHaveLength(1);
  } finally {
    await f.h
      .owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND user_id=${f.owner}`;
    await asRole(f, 'business_manager');
  }
});
