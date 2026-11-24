import { createDatabase } from '@pospay/db';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { walkCommissionStatement } from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import { globalRoleMember, permissionOverride } from './commission-estimate.fixture.ts';
import {
  ids,
  memberWithGrants,
  READ,
  readStatement,
  statementFixture,
  statementRow,
  type StatementFixture,
} from './commission-statement.fixture.ts';

type View = {
  reader_scope: string;
  generated: boolean;
  status: string;
  current_fingerprint?: string;
  current_statement_fingerprint?: string;
  changed_since_review?: boolean;
  change_cause?: string | null;
  employees: { employee_id: string; partial: boolean; rows: { source_ref: string }[] }[];
};

let f: StatementFixture;

beforeAll(async () => {
  f = await statementFixture();
});

afterAll(async () => {
  await f?.h.close();
});

const employeeIds = (view: View): string[] => view.employees.map((entry) => entry.employee_id).sort();

describe('CM-28b reading a month that was never generated (R6)', () => {
  it('returns the computed view with generated false and leaves no row, fingerprint or lock behind', async () => {
    f.h.calls.statements.length = 0;
    f.h.calls.memberSnapshots.length = 0;

    const response = await readStatement(f, f.cookie, '2026-07');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ reader_scope: 'BUSINESS', generated: false, status: 'DRAFT' });
    expect(await statementRow(f, '2026-07')).toBeUndefined();
    const written = f.h.calls.statements.filter((call) =>
      /\b(insert|update|delete)\b|for\s+(update|share|no key update)/i.test(call.sql),
    );
    expect(written).toEqual([]);
    expect(f.h.calls.memberSnapshots).toEqual([{ readOnly: 'on', isolation: 'repeatable read' }]);
  });

  it('is still not generated when an input writer created the row without a fingerprint', async () => {
    // صف DRAFT من غير بصمة، زي اللي بيعمله أي كاتب مدخلات بقفل الشهر.
    await f.h.owner`INSERT INTO commission_statements(company_id,id,business_id,period,status)
      VALUES (${f.company},${ids.newId()},${f.business},'2026-06','DRAFT')`;

    const response = await readStatement(f, f.cookie, '2026-06');

    expect(response.status).toBe(200);
    expect((response.body as unknown as View).generated).toBe(false);
  });
});

describe('CM-23 who sees which employees in the statement view', () => {
  it('shows the business-wide owner every employee and the branch manager only hers', async () => {
    const owner = (await readStatement(f, f.cookie)).body as unknown as View;
    const branch = (await readStatement(f, f.branchCookie)).body as unknown as View;

    expect(owner.reader_scope).toBe('BUSINESS');
    expect(employeeIds(owner)).toEqual([f.employee, f.secondEmployee].sort());
    expect(branch.reader_scope).toBe('BRANCHES');
    expect(employeeIds(branch)).toEqual([f.employee]);
  });

  it('CM-23g gives a reader of both branches (branch grants only) the branch shape, not the whole one', async () => {
    const both = await memberWithGrants(f, 'both-branches', [
      { permission: READ, scope: 'BRANCH' },
      { permission: READ, scope: 'SECOND_BRANCH' },
    ]);
    const view = (await readStatement(f, both.cookie)).body as unknown as View;

    expect(view.reader_scope).toBe('BRANCHES');
    expect(employeeIds(view)).toEqual([f.employee, f.secondEmployee].sort());
    expect(Object.keys(view)).not.toContain('current_fingerprint');
  });

  it('CM-23e lets a DENY on one branch filter a business-wide reader to the other branch', async () => {
    const manager = await globalRoleMember(f, 'business_manager', 'BUSINESS');
    await permissionOverride(f, manager.membershipId, 'DENY', { type: 'BRANCH', id: f.secondBranch });
    const view = (await readStatement(f, manager.cookie)).body as unknown as View;

    expect(view.reader_scope).toBe('BRANCHES');
    expect(employeeIds(view)).toEqual([f.employee]);
  });

  it('refuses a reader whose effective branch set is empty with the uniform 403', async () => {
    const stranger = await memberWithGrants(f, 'no-read', []);
    const response = await readStatement(f, stranger.cookie);

    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
  });
});

describe('CM-23h the per-day rule in the statement view', () => {
  it('gives the branch added mid-month only the days after it, labelled partial, and the first branch the whole month', async () => {
    await f.h.owner`DELETE FROM employee_branches WHERE company_id=${f.company}
      AND employee_id=${f.employee} AND branch_id=${f.secondBranch}`;
    await f.h.owner`INSERT INTO employee_branches(
      company_id,id,business_id,employee_id,branch_id,"from","to")
      VALUES (${f.company},${ids.newId()},${f.business},${f.employee},${f.secondBranch},
        '2026-11-15'::date,NULL)`;
    const db = createDatabase({ url: f.h.urls.app, ids });
    await db.withTenant(f.company, (tx) =>
      insertCommissionLineProjection(tx, f.tenant, ids, {
        lineId: ids.newId(),
        businessDate: '2026-11-20',
        period: '2026-11',
        net: '10.000',
        ruleKind: 'PCT',
        rulePctBps: 1000,
      }),
    );
    await db.close();
    const second = await memberWithGrants(f, 'second-branch', [
      { permission: READ, scope: 'SECOND_BRANCH' },
    ]);

    const first = (await readStatement(f, f.branchCookie)).body as unknown as View;
    const hers = (await readStatement(f, second.cookie)).body as unknown as View;

    const firstSarah = first.employees.find((entry) => entry.employee_id === f.employee);
    const secondSarah = hers.employees.find((entry) => entry.employee_id === f.employee);
    expect(firstSarah?.rows).toHaveLength(2);
    expect(firstSarah?.partial).toBe(false);
    expect(secondSarah?.rows).toHaveLength(1);
    expect(secondSarah?.partial).toBe(true);
  });
});

describe('CM-28c the two shapes on a REVIEWED month', () => {
  it('leaves a branch reader response unchanged when a customer of another branch is renamed, while the business-wide one shows STATEMENT', async () => {
    const other = ids.newId();
    await f.h.owner`INSERT INTO customers(company_id,id,name,phone,locale,created_at,updated_at)
      VALUES (${f.company},${other},'Hawalli customer','+96550000999','ar',now(),now())`;
    const db = createDatabase({ url: f.h.urls.app, ids });
    await db.withTenant(f.company, (tx) =>
      insertCommissionLineProjection(
        tx,
        { ...f.tenant, employee: f.secondEmployee, branch: f.secondBranch, customer: other },
        ids,
        {
          lineId: ids.newId(),
          businessDate: '2026-11-07',
          period: '2026-11',
          net: '10.000',
          ruleKind: 'PCT',
          rulePctBps: 1000,
        },
      ),
    );
    const current = (await readStatement(f, f.cookie)).body as unknown as View;
    const [owner] = await f.h.owner`SELECT id, user_id FROM memberships
      WHERE company_id=${f.company} AND scope_type='COMPANY' LIMIT 1`;
    await walkCommissionStatement(db, {
      tenant: { ...f.tenant, membership: owner?.['id'] as string },
      reviewer: owner?.['user_id'] as string,
      period: '2026-11',
      ids,
      to: 'REVIEWED',
      // المراجع شاف بالظبط بصمتي اللحظة دي، فمفيش تغيّر قبل إعادة التسمية.
      afterReviewed: async (tx, statementId) => {
        await tx.execute(
          sql`UPDATE commission_statements
            SET reviewed_fingerprint=${current.current_fingerprint},
                reviewed_statement_fingerprint=${current.current_statement_fingerprint}
            WHERE company_id=${f.company} AND id=${statementId}`,
        );
      },
    });
    await db.close();
    const manager = await globalRoleMember(f, 'business_manager', 'BUSINESS');
    const branchBefore = await readStatement(f, f.branchCookie);
    const wideBefore = (await readStatement(f, manager.cookie)).body as unknown as View;
    expect(wideBefore).toMatchObject({ status: 'REVIEWED', changed_since_review: false });

    await f.h.owner`UPDATE customers SET name='Renamed in Hawalli' WHERE company_id=${f.company}
      AND id=${other}`;
    const branchAfter = await readStatement(f, f.branchCookie);
    const wideAfter = (await readStatement(f, manager.cookie)).body as unknown as View;

    expect(branchAfter.body).toEqual(branchBefore.body);
    expect(Object.keys(branchAfter.body)).not.toEqual(
      expect.arrayContaining(['current_fingerprint', 'reviewed_fingerprint', 'changed_since_review']),
    );
    expect(wideAfter).toMatchObject({ changed_since_review: true, change_cause: 'STATEMENT' });
  });
});
