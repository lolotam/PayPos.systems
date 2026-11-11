import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { leaveHistoryReportQuery } from '@pospay/contracts';
import { getBusinessLeaveHistory } from '../queries/leave-history-report.query.ts';
import { createLeaveReadAccess } from '../persistence/leave-read-access.adapter.ts';
import type { LeaveReadAccess } from '../queries/leave-requests.query.ts';
import {
  expectPage,
  historyClear,
  historyEmployee,
  historyLeave,
  historyNow,
  historyReport,
  historySession,
  historyShift,
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
  await f.h.owner`UPDATE employees SET deleted_at=NULL WHERE company_id=${f.company}`;
  await setAttachments(f.employee.id, null);
  await f.h.owner`UPDATE memberships SET scope_type='BUSINESS',scope_id=${f.business}
    WHERE company_id=${f.company} AND id=${f.memberId}`;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function setAttachments(employeeId: string, to: string | null) {
  await f.h.owner`DELETE FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${employeeId}`;
  for (const branch of [f.branch, f.secondBranch])
    await f.h
      .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
      VALUES(${f.company},${leaveIds.newId()},${f.business},${employeeId},${branch},'2026-01-01',${to})`;
}

function racing(mutate: () => Promise<unknown>): LeaveReadAccess {
  const real = createLeaveReadAccess({ now: () => new Date(historyNow) });
  return {
    ...real,
    check: async (tx, c) => {
      const scope = await real.check(tx, c);
      await mutate();
      return scope;
    },
  };
}

const reportRead = (access: LeaveReadAccess, q: object = {}) =>
  f.db.withTenant(f.company, (tx) =>
    getBusinessLeaveHistory(
      tx,
      { companyId: f.company, userId: f.userId, businessId: f.business, own: false },
      leaveHistoryReportQuery.parse({ from: '2026-10-01', to: '2026-10-31', ...q }),
      access,
    ),
  );

it('precedence of outcomes: 404 precedes FEATURE_DISABLED, bad cursor and foreign/soft-deleted return null', async () => {
  await f.h.owner`INSERT INTO company_feature_overrides(company_id,flag,enabled,reason,set_by)
    VALUES(${f.company},'staff',false,'Synthetic feature',${f.userId})`;
  try {
    expect(await historyReport(f, { employee_id: leaveIds.newId() })).toBeNull();
    expect(await historyReport(f)).toBe('FEATURE_DISABLED');
  } finally {
    await f.h.owner`DELETE FROM company_feature_overrides
      WHERE company_id=${f.company} AND flag='staff'`;
  }
  expect(await historyReport(f, { employee_id: leaveIds.newId(), cursor: 'bad' })).toBeNull();
  expect(await historyReport(f, { employee_id: f.foreignBranch })).toBeNull();

  await f.h.owner`UPDATE employees SET deleted_at=${historyNow}
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  expect(await historyReport(f, { employee_id: f.employee.id })).toBeNull();
});

it('PP-171 with employee_id: ended attachments answer null, tomorrow or unended readable answers page', async () => {
  await setAttachments(f.employee.id, '2026-11-06');
  expect(await historyReport(f, { employee_id: f.employee.id })).toBeNull();

  await setAttachments(f.employee.id, '2026-11-07');
  expect(await historyReport(f, { employee_id: f.employee.id })).toBeNull();

  await setAttachments(f.employee.id, '2026-11-08');
  expect(await historyReport(f, { employee_id: f.employee.id })).not.toBeNull();

  await f.h.owner`DELETE FROM employee_branches
    WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.company},${leaveIds.newId()},${f.business},${f.employee.id},${f.branch},'2026-01-01','2026-11-07')`;
  await f.h
    .owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES(${f.company},${leaveIds.newId()},${f.business},${f.employee.id},${f.secondBranch},'2026-01-01',NULL)`;
  expect(await historyReport(f, { employee_id: f.employee.id })).not.toBeNull();
});

it('PP-171 without employee_id and soft deletion: drops ended and soft-deleted employee across all three row types', async () => {
  const otherEmployee = await historyEmployee(f, 'Synthetic other employee');
  await f.h.owner`UPDATE memberships SET scope_type='BRANCH',scope_id=${f.branch}
    WHERE company_id=${f.company} AND id=${f.memberId}`;

  for (const emp of [f.employee.id, otherEmployee]) {
    await historyLeave(f, '2026-10-01', { employee: emp, branch: f.branch });
    await historyShift(f, '2026-10-02', { employee: emp, branch: f.branch });
    await historyShift(f, '2026-10-03', { employee: emp, branch: f.branch });
    await historySession(f, '2026-10-03', { employee: emp, branch: f.secondBranch });
  }

  const open = expectPage(await historyReport(f, { from: '2026-10-01', to: '2026-10-03' }));
  expect(open.items.filter((r) => r.employee_id === f.employee.id)).toHaveLength(3);
  expect(open.items.filter((r) => r.employee_id === otherEmployee)).toHaveLength(3);

  await f.h.owner`UPDATE employees SET deleted_at=${historyNow}
    WHERE company_id=${f.company} AND id=${f.employee.id}`;
  const deleted = expectPage(await historyReport(f, { from: '2026-10-01', to: '2026-10-03' }));
  expect(deleted.items.some((r) => r.employee_id === f.employee.id)).toBe(false);
  expect(deleted.items.filter((r) => r.employee_id === otherEmployee)).toHaveLength(3);
  await f.h.owner`UPDATE employees SET deleted_at=NULL
    WHERE company_id=${f.company} AND id=${f.employee.id}`;

  // سجل الفروع يقبل الإغلاق فقط، فالإنهاء آخر خطوة في الاختبار.
  await f.h.owner`UPDATE employee_branches SET "to"='2026-11-07'
    WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
  const ended = expectPage(await historyReport(f, { from: '2026-10-01', to: '2026-10-03' }));
  expect(ended.items.some((r) => r.employee_id === f.employee.id)).toBe(false);
  const otherRows = ended.items.filter((r) => r.employee_id === otherEmployee);
  expect(otherRows.map((r) => r.row_type)).toEqual([
    'COVERED_ELSEWHERE',
    'UNEXCUSED_ABSENCE',
    'LEAVE',
  ]);
});

it('races: concurrent soft delete or attachment end between access.check and final statement drops or returns null', async () => {
  const otherEmployee = await historyEmployee(f, 'Synthetic racing other');
  await historyLeave(f, '2026-10-05', { employee: f.employee.id });
  await historyLeave(f, '2026-10-05', { employee: otherEmployee });

  const softDeleted = await reportRead(
    racing(async () => {
      await f.h.owner`UPDATE employees SET deleted_at=${historyNow}
        WHERE company_id=${f.company} AND id=${f.employee.id}`;
    }),
    { employee_id: f.employee.id },
  );
  expect(softDeleted).toBeNull();

  await f.h.owner`UPDATE employees SET deleted_at=NULL
    WHERE company_id=${f.company} AND id=${f.employee.id}`;

  const attachmentEnded = await reportRead(
    racing(async () => {
      await f.h.owner`UPDATE employee_branches SET "to"='2026-11-07'
        WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
    }),
    { employee_id: f.employee.id },
  );
  expect(attachmentEnded).toBeNull();

  await setAttachments(f.employee.id, null);

  const unfilteredRacing = await reportRead(
    racing(async () => {
      await f.h.owner`UPDATE employee_branches SET "to"='2026-11-07'
        WHERE company_id=${f.company} AND employee_id=${f.employee.id}`;
    }),
    {},
  );
  const racedPage = expectPage(unfilteredRacing);
  expect(racedPage.items.some((r) => r.employee_id === f.employee.id)).toBe(false);
  expect(racedPage.items.some((r) => r.employee_id === otherEmployee)).toBe(true);
});
