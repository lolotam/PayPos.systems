import type { TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { createLeaveTransactions } from '../persistence/drizzle-leave-transactions.ts';
import { employeeLeaveHistory, pendingLeaveInbox } from '../queries/leave-requests.query.ts';
import { CancelLeaveUseCase } from '../use-cases/cancel-leave/cancel-leave.usecase.ts';
import { RequestLeaveUseCase } from '../use-cases/request-leave/request-leave.usecase.ts';
import {
  leaveActor,
  leaveContext,
  leaveFixture,
  leaveIds,
  leaveTerms,
  type LeaveFixture,
} from './leave.fixture.ts';

let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
afterEach(() => vi.restoreAllMocks());

function beforeExpiryDatabase(expiresAt: Date): TenantWrappers {
  return {
    ...f.db,
    withTenant: (company, work, options) =>
      f.db.withTenant(
        company,
        async (tx) => {
          const [row] = await tx.execute<{ started_at: string }>(
            sql`SELECT now()::text AS started_at`,
          );
          if (!row) throw new Error('Missing transaction start');
          // يثبت الشرط داخل كل معاملة دون انتظار حقيقي أو سباق مع ساعة قاعدة البيانات.
          expect(new Date(row.started_at).getTime()).toBeLessThan(expiresAt.getTime());
          return work(tx);
        },
        options,
      ),
  };
}

it.each([0, 1])(
  'uses the shared Clock at override expiry plus %i ms for request, both reads and cancel',
  async (offset) => {
    const [override] = await f.h.owner`
    INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by,expires_at)
    VALUES(${f.company},'staff',false,'Synthetic expiry regression',${f.userId},date_trunc('milliseconds',now())+interval '1 hour')
    ON CONFLICT(company_id,flag) DO UPDATE SET expires_at=EXCLUDED.expires_at
    RETURNING expires_at`;
    if (!override) throw new Error('Missing synthetic feature override');
    const expiresAt = new Date(override['expires_at'] as string);
    const sampled = new Date(expiresAt.getTime() + offset);
    const clock = vi.spyOn(f.clock, 'now').mockReturnValue(sampled);
    const database = beforeExpiryDatabase(expiresAt);
    const transactions = createLeaveTransactions(database, leaveIds);
    const request = new RequestLeaveUseCase(transactions, leaveIds, f.clock);
    const cancel = new CancelLeaveUseCase(transactions, f.clock);
    const made = await request.execute(leaveActor(f), leaveTerms());
    expect(made.requested_at).toBe(sampled.toISOString());
    const context = leaveContext(f);
    const history = await database.withTenant(f.company, (tx) =>
      employeeLeaveHistory(tx, context, { limit: 20 }, f.access),
    );
    expect(history).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: made.id })]),
    });
    const inbox = await database.withTenant(f.company, (tx) =>
      pendingLeaveInbox(
        tx,
        { companyId: f.company, userId: f.userId, businessId: f.business, own: false },
        { limit: 20 },
        f.access,
      ),
    );
    expect(inbox).toMatchObject({ items: [expect.objectContaining({ id: made.id })] });
    const cancelled = await cancel.execute(
      { ...leaveActor(f), leaveId: made.id },
      { expected_revision: 1 },
    );
    expect(cancelled).toMatchObject({ status: 'CANCELLED', cancelled_at: sampled.toISOString() });
    expect(clock).toHaveBeenCalledTimes(4);
  },
);
