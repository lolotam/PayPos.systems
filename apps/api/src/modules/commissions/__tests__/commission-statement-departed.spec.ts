import { createDatabase } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertCommissionCorrection, lockTargetStatement } from '../../../../../../packages/db/test/commission-correction-fixtures.ts';
import {
  insertCommissionLine,
  walkCommissionStatement,
} from '../../../../../../packages/db/test/commission-statement-fixtures.ts';
import {
  ids,
  readStatement,
  statementFixture,
  type StatementFixture,
} from './commission-statement.fixture.ts';

type View = { status?: string; employees: { employee_id: string; departed: boolean }[] };

let f: StatementFixture;
let before = '';
let after = '';

const insertEmployee = async (name: string, number: number, deletedAt: string) => {
  const id = ids.newId();
  await f.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${f.company},${id},${f.business},${f.branch},${name},${employeeNameMatchKey(name)},
      'staff','2025-01-01'::date,${number})`;
  await f.h.owner`UPDATE employees SET deleted_at=${deletedAt}::timestamptz
    WHERE company_id=${f.company} AND id=${id}`;
  return id;
};

const flagOf = (view: View, id: string) => view.employees.find((entry) => entry.employee_id === id)?.departed;

beforeAll(async () => {
  f = await statementFixture();
  const db = createDatabase({ url: f.h.urls.app, ids });
  const november = await lockTargetStatement({
    db,
    companyId: f.company,
    businessId: f.business,
    period: '2026-11',
    ids,
  });
  // التوقيت المحلي للنشاط Asia/Kuwait (UTC+3): 23:30 يوم 10-31 قبل الشهر، و00:30 يوم 11-01 جواه.
  before = await insertEmployee('Deleted Before Dina', 31, '2026-10-31T20:30:00Z');
  after = await insertEmployee('Deleted After Dalal', 32, '2026-10-31T21:30:00Z');
  await db.withTenant(f.company, async (tx) => {
    for (const employee of [before, after]) {
      await insertCommissionCorrection(tx, { ...f.tenant, employee }, ids, november, {
        sourcePeriod: '2026-10',
        attachedBranchIds: [f.branch],
      });
    }
  });
  await db.close();
});

afterAll(async () => {
  await f?.h.close();
});

describe('the departed flag at the local midnight of the business (CM-50)', () => {
  it('reads the deletion on the business local day, so 23:30 before the month departs and 00:30 inside it does not', async () => {
    const view = (await readStatement(f, f.cookie)).body as unknown as View;

    expect(view.employees.map((entry) => entry.employee_id)).toEqual(
      expect.arrayContaining([before, after]),
    );
    expect(flagOf(view, before)).toBe(true);
    expect(flagOf(view, after)).toBe(false);
  });

  it('keeps the same flags on the approved closed statement, read from the frozen rows', async () => {
    const db = createDatabase({ url: f.h.urls.app, ids });
    const [owner] = await f.h.owner`SELECT id, user_id FROM memberships
      WHERE company_id=${f.company} AND scope_type='COMPANY' LIMIT 1`;
    await walkCommissionStatement(db, {
      tenant: { ...f.tenant, membership: owner?.['id'] as string },
      reviewer: owner?.['user_id'] as string,
      period: '2026-11',
      ids,
      to: 'APPROVED',
      afterApproved: async (tx, statementId) => {
        for (const [index, employee] of [before, after, f.employee].entries()) {
          await insertCommissionLine(tx, { ...f.tenant, employee }, statementId, ids, {
            kind: 'EMPLOYEE',
            employeeId: employee,
            employeeNumber: 40 + index,
            sourceRef: `employee:${employee}`,
          });
        }
      },
    });
    await db.close();

    const view = (await readStatement(f, f.cookie)).body as unknown as View;

    expect(view.status).toBe('APPROVED');
    expect(flagOf(view, before)).toBe(true);
    expect(flagOf(view, after)).toBe(false);
    expect(flagOf(view, f.employee)).toBe(false);
  });
});
