import { afterAll, beforeAll, expect, it } from 'vitest';
import { ROLE, type Tenant } from './not-clocked-in.fixture.ts';
import {
  BREAK_ALERT_AT,
  BREAK_OUT,
  MORNING_IN,
  breakNotReturnedFixture,
  type BreakNotReturnedFixture,
} from './break-not-returned.fixture.ts';
import {
  MANAGER_ROLES,
  auditRows,
  breakLedger,
  outboxRows,
  saveRule,
  type RuleContext,
} from './alert-rule.helpers.ts';
import type { BreakNotReturnedTransactions } from '../ports/break-not-returned.port.ts';

const NOT_RETURNED = 'SHIFT_BREAK_NOT_RETURNED';
const EVENT = 'ShiftBreakNotReturned';
const minute = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000);

let f: BreakNotReturnedFixture;
let ctx: RuleContext;
beforeAll(async () => {
  f = await breakNotReturnedFixture();
  ctx = { owner: f.owner, ids: f.ids, userId: await f.user('rule-editor') };
});
afterAll(async () => {
  await f?.close();
});

/** موظفة في فرع له مدير، ووردية فيها بريك، وجلسة الصبح اللي قفلتها جوّه البريك. */
async function onBreak() {
  const tenant = await f.tenant();
  const manager = await f.user('manager');
  await f.member({
    tenant,
    userId: manager,
    roleId: ROLE.branch_manager,
    scopeType: 'BRANCH',
    scopeId: tenant.branch,
  });
  const employee = await f.employee(tenant, { nameEn: 'Sara', nameAr: 'سارة' });
  await f.breakShift(tenant, employee);
  await f.session(tenant, employee, { clockIn: MORNING_IN, clockOut: BREAK_OUT });
  return { tenant, manager, employee };
}

/** رجوع لفرع تاني في لحظة. */
async function returnedElsewhere(tenant: Tenant, employee: string, at: Date) {
  const other = await f.branch(tenant);
  await f.session(tenant, employee, { clockIn: at, branch: other });
  return other;
}

/** منفذ بيكتب التحويل زي ما هو وبعدين يفشل، فالمعاملة ترجع زي ما كانت. */
function failingPort(transactions: BreakNotReturnedTransactions): BreakNotReturnedTransactions {
  return {
    candidates: transactions.candidates,
    run: (company, employeeId, sample, work) =>
      transactions.run(company, employeeId, sample, async (tx, at) =>
        work(
          {
            ...tx,
            convert: async (notice) => {
              await tx.convert(notice);
              throw new Error('SYNTHETIC_CONVERSION_OUTBOX_FAILURE');
            },
          },
          at,
        ),
      ),
  };
}

it('two concurrent workers convert the suppressed row once', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 2));
  f.setNow(minute(BREAK_ALERT_AT, 10));
  const [first, second] = await Promise.all([
    f.detectBreak().execute(tenant.company),
    f.detectBreak().execute(tenant.company),
  ]);
  expect(first.notified + second.notified).toBe(1);
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(1);
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_at']).toBeNull();
  expect(rows[0]?.['suppressed_kind']).toBeNull();
});

it('a failed conversion rolls the whole notice back and the next run converts once', async () => {
  const { tenant, employee } = await onBreak();
  await saveRule(ctx, tenant, NOT_RETURNED, { enabled: false, roles: MANAGER_ROLES });
  f.setNow(BREAK_ALERT_AT);
  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 0 });
  await returnedElsewhere(tenant, employee, minute(BREAK_ALERT_AT, 2));
  f.setNow(minute(BREAK_ALERT_AT, 10));
  await expect(f.detectBreak(failingPort(f.breakTransactions)).execute(tenant.company)).rejects.toThrow(
    'ATTENDANCE_BREAK_NOT_RETURNED_RETRY',
  );
  const rows = await breakLedger(ctx, tenant.company, employee);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.['suppressed_kind']).toBe('NOT_RETURNED');
  expect(rows[0]?.['suppressed_at']).not.toBeNull();
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(0);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(0);
  expect(f.breakFailures).toHaveLength(1);

  expect(await f.detectBreak().execute(tenant.company)).toEqual({ notified: 1 });
  expect(await outboxRows(ctx, tenant.company, EVENT)).toHaveLength(1);
  expect(await auditRows(ctx, tenant.company)).toHaveLength(1);
});
