import { createDatabase } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { lockTargetStatement } from '../../../../../../packages/db/test/commission-correction-fixtures.ts';
import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import {
  generateStatement,
  ids,
  memberWithGrants,
  READ,
  readStatement,
  statementFixture,
  type StatementFixture,
} from './commission-statement.fixture.ts';

type Issue = { kind: string; code: string; source_period: string | null };
type View = { employees: { employee_id: string; issues: Issue[] }[] };

let f: StatementFixture;
let november = '';
let leaver = '';

const issuesOf = (view: View, employee: string): Issue[] | undefined =>
  view.employees.find((entry) => entry.employee_id === employee)?.issues;

const blockedRow = (employee: string, source: string) =>
  f.h.owner`INSERT INTO commission_blocked_corrections(
    company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
    target_statement_id,created_at)
    VALUES (${f.company},${ids.newId()},${f.business},${employee},${source},'NO_PLAN',
      ${ids.newId()},'2026-11',${november},now())`;

beforeAll(async () => {
  f = await statementFixture();
  const db = createDatabase({ url: f.h.urls.app, ids });
  november = await lockTargetStatement({
    db,
    companyId: f.company,
    businessId: f.business,
    period: '2026-11',
    ids,
  });
  // سارة: الفرع الأول من أول الشهر، والتاني من 15 نوفمبر. بند من غير خطة يوم 5 (فرع أول بس) وبند عادي يوم 20.
  await f.h.owner`DELETE FROM employee_branches WHERE company_id=${f.company}
    AND employee_id=${f.employee} AND branch_id=${f.secondBranch}`;
  await f.h.owner`INSERT INTO employee_branches(
    company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES (${f.company},${ids.newId()},${f.business},${f.employee},${f.secondBranch},
      '2026-11-15'::date,NULL)`;
  await db.withTenant(f.company, async (tx) => {
    await insertCommissionLineProjection(tx, f.tenant, ids, {
      lineId: ids.newId(),
      businessDate: '2026-11-05',
      period: '2026-11',
      net: '10.000',
      ruleKind: 'FOLLOW_PLAN',
    });
    await insertCommissionLineProjection(tx, f.tenant, ids, {
      lineId: ids.newId(),
      businessDate: '2026-11-20',
      period: '2026-11',
      net: '10.000',
      ruleKind: 'PCT',
      rulePctBps: 1000,
    });
  });
  await db.close();
  await blockedRow(f.employee, '2026-09');
  leaver = ids.newId();
  await f.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,
    contract_end,employee_number)
    VALUES (${f.company},${leaver},${f.business},${f.branch},'Leaver Lina',
      ${employeeNameMatchKey('Leaver Lina')},'staff','2025-01-01'::date,'2025-12-31'::date,30)`;
  await blockedRow(leaver, '2026-10');
});

afterAll(async () => {
  await f?.h.close();
});

describe('which issues a reader sees (FR-025, FR-027)', () => {
  it('shows a business-wide reader the pricing failure and the open blocked correction of an employee', async () => {
    const view = (await readStatement(f, f.cookie)).body as unknown as View;

    expect(issuesOf(view, f.employee)).toEqual([
      { kind: 'PRICING', code: 'NO_PLAN', source_period: null },
      { kind: 'BLOCKED_CORRECTION', code: 'NO_PLAN', source_period: '2026-09' },
    ]);
  });

  it('shows the first branch the failure of a source on her days and never the blocked correction', async () => {
    const view = (await readStatement(f, f.branchCookie)).body as unknown as View;

    expect(issuesOf(view, f.employee)).toEqual([
      { kind: 'PRICING', code: 'NO_PLAN', source_period: null },
    ]);
  });

  it('shows the branch added mid-month no failure of a source before her days, nor the blocked correction', async () => {
    const second = await memberWithGrants(f, 'second-branch-issues', [
      { permission: READ, scope: 'SECOND_BRANCH' },
    ]);
    const view = (await readStatement(f, second.cookie)).body as unknown as View;

    expect(issuesOf(view, f.employee)).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('2026-09');
  });
});

describe('an employee outside the month whose only entry is an open blocker (FR-027)', () => {
  it('is listed with the issue for the business-wide reader on GET, and absent for a branch reader', async () => {
    const wide = (await readStatement(f, f.cookie)).body as unknown as View;
    const branch = (await readStatement(f, f.branchCookie)).body as unknown as View;

    expect(issuesOf(wide, leaver)).toEqual([
      { kind: 'BLOCKED_CORRECTION', code: 'NO_PLAN', source_period: '2026-10' },
    ]);
    expect(branch.employees.map((entry) => entry.employee_id)).not.toContain(leaver);
  });

  it('is listed with the issue by generate too', async () => {
    const response = await generateStatement(f, f.cookie, 'blocker-only');

    expect(response.status).toBe(200);
    expect(issuesOf(response.body as unknown as View, leaver)).toHaveLength(1);
  });
});
