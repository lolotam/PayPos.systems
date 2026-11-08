import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { leavePage } from '@pospay/contracts';
import { employeeLeaveHistory, pendingLeaveInbox } from '../queries/leave-requests.query.ts';
import type { LeaveReadAccess } from '../queries/leave-requests.query.ts';
import { getEmployeeLeaveHistory } from '../queries/leave-history.query.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import { encodeCursor } from '../../../shared/persistence/name-options-cursor.ts';
import {
  historyClear,
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
});
beforeEach(async () => {
  await historyClear(f);
  await f.h.owner`DELETE FROM permission_overrides
    WHERE company_id=${f.company} AND permission_code='read:leave:branch'`;
  await freshAttachments(null);
  await f.h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company}`;
  await f.h.owner`UPDATE businesses SET timezone='Asia/Kuwait' WHERE company_id=${f.company}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
const access = (now = historyNow) => createLeaveReadAccess({ now: () => new Date(now) });
const read = async (now = historyNow, q: object = {}, zone?: 'Etc/GMT+12') =>
  f.db.withTenant(f.company, async (tx) => {
    if (zone) await tx.execute(sql`SET LOCAL TIME ZONE 'Etc/GMT+12'`);
    return getEmployeeLeaveHistory(tx, leaveContext(f), historyQuery(q), access(now));
  });
const page = (result: Awaited<ReturnType<typeof read>>) =>
  result === null || typeof result === 'string' ? null : result;
async function freshAttachments(to: string | null, from = '2026-01-01') {
  // بيانات مستقلة لكل حالة؛ الارتباط المغلق لا يُفتح ولا يتغيّر تاريخ بدايته.
  await f.h.owner`DELETE FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  for (const branch of [f.branch, f.secondBranch])
    await f.h.owner`INSERT INTO employee_branches
      (company_id,id,business_id,employee_id,branch_id,"from","to")
      VALUES(${f.company},${leaveIds.newId()},${f.business},${f.employee.id},${branch},${from},${to})`;
}
const denyRead = (branch: string) =>
  f.h.owner`INSERT INTO permission_overrides
    (company_id,id,membership_id,permission_code,effect,scope_type,scope_id,reason,granted_by)
    VALUES(${f.company},${leaveIds.newId()},${f.memberId},'read:leave:branch','DENY','BRANCH',${branch},'Synthetic deny',${f.userId})`;

it('an attachment ending today is ended; ending tomorrow or never is still eligible', async () => {
  await freshAttachments('2026-11-06');
  expect(await read()).toBeNull();
  await freshAttachments('2026-11-07');
  expect(await read()).toBeNull();
  await freshAttachments('2026-11-08');
  expect(page(await read())).not.toBeNull();
  await freshAttachments(null);
  expect(page(await read())).not.toBeNull();
});

it('an attachment that starts in the future stays eligible under the end-only rule', async () => {
  await freshAttachments(null, '2026-12-01');
  expect(page(await read())).not.toBeNull();
});

it('a disabled feature takes precedence over ended history attachments', async () => {
  await freshAttachments('2026-11-07');
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'Synthetic feature',${f.userId})`;
  try {
    expect(await read()).toBe('FEATURE_DISABLED');
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides
      WHERE company_id=${f.company} AND flag='staff'`;
  }
  expect(await read()).toBeNull();
});

it('an ended readable attachment beside a valid unreadable one is refused', async () => {
  await f.h.owner`UPDATE employee_branches SET "to"='2026-11-07'
    WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.branch}`;
  await denyRead(f.secondBranch);
  expect(await read()).toBeNull();
});

it('one valid readable attachment keeps the history open and the historic facts keep their scope', async () => {
  await f.h.owner`UPDATE employee_branches SET "to"='2026-11-07'
    WHERE company_id=${f.company} AND employee_id=${f.employee.id} AND branch_id=${f.secondBranch}`;
  const leave = await historyLeave(f, '2026-10-05', { branch: f.secondBranch });
  const result = page(await read());
  expect(result?.items.map((r) => r.id)).toEqual([leave]);
  expect(result?.last_taken?.annual).toEqual({ from: '2026-10-05', to: '2026-10-05' });
});

it('the branch timezone decides the day at local midnight and the business timezone is the fallback', async () => {
  await freshAttachments('2026-11-08');
  // 21:00Z منتصف ليل الكويت (8 نوفمبر) مقابل 11:00 ظهراً في هونولولو (7 نوفمبر).
  expect(await read('2026-11-07T21:00:00.000Z')).toBeNull();
  await f.h.owner`UPDATE branches SET timezone='Pacific/Honolulu' WHERE company_id=${f.company}`;
  expect(page(await read('2026-11-07T21:00:00.000Z'))).not.toBeNull();
  await f.h.owner`UPDATE branches SET timezone=NULL WHERE company_id=${f.company}`;
  await f.h.owner`UPDATE businesses SET timezone='Pacific/Honolulu' WHERE company_id=${f.company}`;
  expect(page(await read('2026-11-07T21:00:00.000Z'))).not.toBeNull();
});

it('the injected clock decides eligibility and not the database session timezone', async () => {
  await freshAttachments('2026-11-07');
  expect(await read(historyNow, {}, 'Etc/GMT+12')).toBeNull();
  await freshAttachments('2026-11-08');
  expect(page(await read(historyNow, {}, 'Etc/GMT+12'))).not.toBeNull();
});

it('a cursor from the previous day cannot revive an eligibility that ended today', async () => {
  await freshAttachments('2026-11-07');
  const cursor = encodeCursor({
    date: '2026-10-01',
    rank: 1,
    id: leaveIds.newId(),
    as_of: '2026-11-06T10:00:00.000Z',
  });
  expect(await read(historyNow, { cursor })).toBeNull();
});

it.each(['absent', 'empty'])('missing history eligibility data (%s) fails closed', async (kind) => {
  const scope = await f.db.withTenant(f.company, (tx) => access().check(tx, leaveContext(f)));
  if (!scope) throw new Error('Expected leave read scope');
  const legacyScope: NonNullable<Awaited<ReturnType<LeaveReadAccess['check']>>> = { ...scope };
  delete legacyScope.eligibilityDays;
  const withoutEligibility: LeaveReadAccess = {
    check: async () => (kind === 'absent' ? legacyScope : { ...scope, eligibilityDays: [] }),
  };
  const result = await f.db.withTenant(f.company, (tx) =>
    getEmployeeLeaveHistory(tx, leaveContext(f), historyQuery(), withoutEligibility),
  );
  expect(result).toBeNull();
});

it('the open list, the inbox and the personal list keep their outcome when the attachment ended today', async () => {
  await freshAttachments('2026-11-07');
  const approved = await historyLeave(f, '2026-10-05');
  const pending = await historyLeave(f, '2026-10-06', { status: 'PENDING' });
  const open = await f.db.withTenant(f.company, (tx) =>
    employeeLeaveHistory(tx, leaveContext(f), { limit: 50 }, access()),
  );
  expect(
    leavePage
      .parse(open)
      .items.map((r) => r.id)
      .sort(),
  ).toEqual([approved, pending].sort());
  const inbox = await f.db.withTenant(f.company, (tx) =>
    pendingLeaveInbox(tx, leaveContext(f), { limit: 50 }, access()),
  );
  expect(leavePage.parse(inbox).items.map((r) => r.id)).toEqual([pending]);
  const own = await f.db.withTenant(f.company, (tx) =>
    employeeLeaveHistory(
      tx,
      { ...leaveContext(f), own: true, branchId: f.branch },
      { limit: 50 },
      access(),
    ),
  );
  expect(own).toBeNull();
  expect(await read()).toBeNull();
});

it('only the history reader asks for the internal purpose', async () => {
  const seen: (string | undefined)[] = [];
  const spy: LeaveReadAccess = {
    check: async (tx, c) => {
      seen.push(c.purpose);
      return access().check(tx, c);
    },
  };
  await f.db.withTenant(f.company, (tx) =>
    employeeLeaveHistory(tx, leaveContext(f), { limit: 50 }, spy),
  );
  await f.db.withTenant(f.company, (tx) =>
    getEmployeeLeaveHistory(tx, leaveContext(f), historyQuery(), spy),
  );
  expect(seen).toEqual([undefined, 'history']);
});
