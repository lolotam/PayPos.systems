import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import { CorrectAttendanceUseCase } from '../use-cases/correct-attendance/correct-attendance.usecase.ts';
import { createAttendanceCorrectionTransactions } from '../persistence/drizzle-attendance-correction-transactions.ts';
import {
  attendanceChangeFixture,
  changeActor,
  voidInput,
  voidRow,
  voidAudits,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { correctionActor, correctionInput } from './attendance-correction.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
function gate() {
  let locked!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    ready,
    release,
    pause: async () => {
      locked();
      await held;
    },
  };
}
async function waitForStateLock() {
  await vi.waitFor(
    async () => {
      const rows = await f.h
        .owner`SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%attendance_states%' AND pid<>pg_backend_pid()`;
      expect(rows.length).toBeGreaterThan(0);
    },
    { timeout: 5000 },
  );
}
it.each(['void', 'correction'] as const)(
  'AVS-10 serializes %s first against the other writer',
  async (winner) => {
    const input = await voidInput(f);
    const row = await f.fileChange.execute(changeActor(f), input);
    const lock = gate();
    const approve = new DecideAttendanceChangeUseCase(
      {
        ...f.tx,
        decide: (actor, clock, work) =>
          f.tx.decide(actor, clock, async (scope) => {
            if (winner === 'void') await lock.pause();
            return work(scope);
          }),
      },
      f.clock,
      f.kinds,
    );
    const tx = createAttendanceCorrectionTransactions(f.db, leaveIds);
    const correct = new CorrectAttendanceUseCase(
      {
        run: (actor, clock, work) =>
          tx.run(actor, clock, async (scope) => {
            if (winner === 'correction') await lock.pause();
            return work(scope);
          }),
      },
      f.clock,
    );
    const decide = () =>
      approve.execute(changeActor(f, row.id, f.owner), { decision: 'APPROVED', revision: 0 });
    const correction = () =>
      correct.execute(correctionActor(f, input.session_id), correctionInput());
    const first = winner === 'void' ? decide() : correction();
    await lock.ready;
    const outcomes = Promise.allSettled([first, winner === 'void' ? correction() : decide()]);
    try {
      await waitForStateLock();
    } finally {
      lock.release();
    }
    expect(await outcomes).toMatchObject([
      { status: 'fulfilled' },
      {
        status: 'rejected',
        reason: {
          code:
            winner === 'void'
              ? 'ATTENDANCE_SESSION_VOIDED'
              : 'ATTENDANCE_SESSION_REVISION_CONFLICT',
        },
      },
    ]);
    expect(await voidRow(f, input.session_id)).toMatchObject({ revision: 1 });
    expect(await voidAudits(f, input.session_id)).toHaveLength(winner === 'void' ? 1 : 0);
    const [request] = await f.h
      .owner`SELECT status FROM attendance_change_requests WHERE company_id=${f.company} AND id=${row.id}`;
    expect(request?.status).toBe(winner === 'void' ? 'APPROVED' : 'PENDING');
  },
);

it.each(['original approval', 'owner one-step void'] as const)(
  'AVS-15 serializes restore approval against %s',
  async (contender) => {
    const input = await voidInput(f);
    const original = await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
    const restore = await f.fileChange.execute(changeActor(f), {
      ...input,
      kind: 'RESTORE_SESSION',
      session_revision: 1,
    });
    const lock = gate();
    const usecase = new DecideAttendanceChangeUseCase(
      {
        ...f.tx,
        decide: (actor, clock, work) =>
          f.tx.decide(actor, clock, async (scope) => {
            await lock.pause();
            return work(scope);
          }),
      },
      f.clock,
      f.kinds,
    );
    const first = usecase.execute(changeActor(f, restore.id, f.owner), {
      decision: 'APPROVED',
      revision: 0,
    });
    await lock.ready;
    const second =
      contender === 'original approval'
        ? f.decideChange.execute(changeActor(f, original.id, f.owner), {
            decision: 'APPROVED',
            revision: original.revision,
          })
        : f.fileChange.execute(changeActor(f, undefined, f.owner), {
            ...input,
            session_revision: 1,
          });
    const outcomes = Promise.allSettled([first, second]);
    try {
      await waitForStateLock();
    } finally {
      lock.release();
    }
    expect(await outcomes).toMatchObject([
      { status: 'fulfilled' },
      {
        status: 'rejected',
        reason: {
          code:
            contender === 'original approval'
              ? 'ATTENDANCE_CHANGE_NOT_PENDING'
              : 'ATTENDANCE_SESSION_REVISION_CONFLICT',
        },
      },
    ]);
    expect(await voidRow(f, input.session_id)).toMatchObject({ revision: 2, voided_at: null });
    expect(await voidAudits(f, input.session_id)).toHaveLength(2);
  },
);
