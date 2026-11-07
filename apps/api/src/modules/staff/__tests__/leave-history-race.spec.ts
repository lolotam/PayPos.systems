import { afterAll, beforeAll, expect, it } from 'vitest';
import { getEmployeeLeaveHistory } from '../queries/leave-history.query.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import type { LeaveReadAccess } from '../queries/leave-requests.query.ts';
import {
  historyLeave,
  historyNow,
  historyQuery,
  leaveContext,
  leaveFixture,
  leaveIds,
  type LeaveFixture,
} from './leave-history.fixture.ts';
let f: LeaveFixture;
beforeAll(async () => {
  f = await leaveFixture();
  await historyLeave(f, '2026-10-05');
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

// الحذف بيتعمل commit من connection تانية بعد ما الصلاحية اتحسبت وقبل الـSQL النهائي،
// فده نفس ترتيب السباق تحت READ COMMITTED.
function racingDelete(employeeId: string): LeaveReadAccess {
  const real = createLeaveReadAccess({ now: () => new Date(historyNow) });
  return {
    ...real,
    check: async (tx, c) => {
      const scope = await real.check(tx, c);
      await f.h.owner`UPDATE employees SET deleted_at=${historyNow}
        WHERE company_id=${f.company} AND id=${employeeId}`;
      return scope;
    },
  };
}
const read = (access: LeaveReadAccess) =>
  f.db.withTenant(f.company, (tx) =>
    getEmployeeLeaveHistory(
      tx,
      leaveContext(f),
      historyQuery({ from: '2026-10-01', to: '2026-10-31' }),
      access,
    ),
  );

it('a racing write that misses the subject keeps the page and its last leave', async () => {
  const result = await read(racingDelete(leaveIds.newId()));
  expect(result).toMatchObject({ last_taken: { annual: { from: '2026-10-05' } } });
});
it('a soft delete committed between access.check and the history SQL returns not found', async () => {
  expect(await read(racingDelete(f.employee.id))).toBeNull();
});
