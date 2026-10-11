import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { sql } from 'drizzle-orm';
import type { TenantWrappers } from '@pospay/db';
import { createAttendanceChangeTransactions } from '../persistence/drizzle-attendance-change-transactions.ts';
import { RequestAttendanceChangeUseCase } from '../use-cases/request-attendance-change/request-attendance-change.usecase.ts';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeAudits,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { asRole } from './attendance-exception.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

function signal() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function withBranchLock(work: () => Promise<void>) {
  const ready = signal(),
    release = signal();
  const connection = postgres(f.h.urls.owner, { max: 1 });
  const blocker = connection.begin(async (tx) => {
    await tx`SELECT id FROM branches WHERE company_id=${f.company} AND id=${f.branch} FOR UPDATE`;
    ready.resolve();
    await release.promise;
  });
  try {
    await Promise.race([ready.promise, blocker]);
    await work();
  } finally {
    release.resolve();
    await blocker;
    await connection.end();
  }
}

async function branchWaiter() {
  await vi.waitFor(
    async () => {
      const waiters = await f.h.owner`SELECT pid FROM pg_stat_activity
        WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%FOR SHARE OF b,bu%' AND pid<>pg_backend_pid()`;
      expect(waiters.length).toBeGreaterThan(0);
    },
    { timeout: 3000, interval: 10 },
  );
}

it.each(['file', 'decide'] as const)(
  'refuses %s when membership expires during the manual kind branch lock wait',
  async (action) => {
    const input = {
      ...changeInput(f),
      clock_in: '2026-09-30T07:00:00Z',
      clock_out: '2026-09-30T16:00:00Z',
    };
    const row = action === 'decide' ? await f.fileChange.execute(changeActor(f), input) : null;
    if (row) await asRole(f, 'owner');
    const userId = action === 'decide' ? f.owner : f.approverId;
    await f.h.owner`UPDATE memberships SET ends_at='2026-10-04T10:01:00Z'
      WHERE company_id=${f.company} AND user_id=${userId}`;
    let now = f.clock.now();
    const clock = { now: vi.fn(() => now) };
    const actor = changeActor(f, row?.id, userId);
    let outcome!: Promise<unknown>;
    try {
      await withBranchLock(async () => {
        const operation = row
          ? new DecideAttendanceChangeUseCase(f.tx, clock, f.kinds).execute(actor, {
              decision: 'APPROVED',
              revision: 0,
            })
          : new RequestAttendanceChangeUseCase(f.tx, clock, f.kinds, leaveIds).execute(actor, input);
        outcome = operation.catch((error: unknown) => error);
        await branchWaiter();
        now = new Date('2026-10-04T10:02:00Z');
      });
      expect(await outcome).toMatchObject({ code: 'NOT_FOUND' });
      expect(clock.now).toHaveBeenCalledTimes(2);
      expect(await f.h.owner`SELECT key FROM idempotency_keys WHERE key=${actor.key}`).toHaveLength(
        0,
      );
      expect(
        await f.h.owner`SELECT id FROM attendance_sessions WHERE employee_id=${f.employee.id}`,
      ).toHaveLength(0);
      if (row) {
        expect(
          await f.h
            .owner`SELECT status,session_id FROM attendance_change_requests WHERE id=${row.id}`,
        ).toEqual([{ status: 'PENDING', session_id: null }]);
        expect(await changeAudits(f, row.id)).toHaveLength(1);
      } else {
        expect(
          await f.h.owner`SELECT id FROM attendance_change_requests WHERE requested_by=${userId}`,
        ).toHaveLength(0);
      }
    } finally {
      await outcome;
      await f.h.owner`UPDATE memberships SET ends_at=NULL
        WHERE company_id=${f.company} AND user_id=${userId}`;
      if (row) await asRole(f, 'business_manager');
    }
  },
);

it('refuses an unauthorized filer without waiting for a locked branch', async () => {
  await asRole(f, 'viewer');
  const database: TenantWrappers = {
    ...f.db,
    withTenant: (companyId, work, context) =>
      f.db.withTenant(
        companyId,
        async (tx) => {
          await tx.execute(sql`SET LOCAL lock_timeout='200ms'`);
          await tx.execute(sql`SET LOCAL statement_timeout='1000ms'`);
          return work(tx);
        },
        context,
      ),
  };
  const transactions = createAttendanceChangeTransactions(database, leaveIds, f.kinds);
  const useCase = new RequestAttendanceChangeUseCase(transactions, f.clock, f.kinds, leaveIds);
  const actor = changeActor(f);
  const before = await f.h.owner`SELECT id FROM attendance_change_requests ORDER BY id`;
  try {
    await withBranchLock(async () => {
      await expect(useCase.execute(actor, changeInput(f))).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await f.h.owner`SELECT key FROM idempotency_keys WHERE key=${actor.key}`).toHaveLength(
        0,
      );
      expect(await f.h.owner`SELECT id FROM attendance_change_requests ORDER BY id`).toEqual(
        before,
      );
    });
  } finally {
    await asRole(f, 'business_manager');
  }
});
