import { createDatabase } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertCommissionCorrection, lockTargetStatement } from '../../../../../../packages/db/test/commission-correction-fixtures.ts';
import { insertCommissionLineProjection } from '../../../../../../packages/db/test/commission-line-fixtures.ts';
import { MISSING_NAME_PLACEHOLDER } from '../domain/statement-names.ts';
import { readCommissionStatementSource } from '../persistence/commission-statement-source.ts';
import { computeStatement } from '../use-cases/compute-statement-view/compute-statement-view.ts';
import { CanonicalSha256FingerprintHasher } from '../persistence/canonical-sha256-fingerprint-hasher.ts';
import {
  ids,
  readStatement,
  statementFixture,
  statementReaders,
  type StatementFixture,
} from './commission-statement.fixture.ts';

type View = {
  current_fingerprint: string;
  employees: {
    employee_id: string;
    rows: { kind: string; customer_name: string | null; service_name_en: string | null }[];
    issues: { kind: string; code: string; source_period: string | null }[];
  }[];
};

let f: StatementFixture;
let november = '';

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
  await db.close();
});

afterAll(async () => {
  await f?.h.close();
});

const sourceWith = async (providers = statementReaders().providers) => {
  const db = createDatabase({ url: f.h.urls.app, ids });
  try {
    return await db.withTenant(f.company, (tx) =>
      readCommissionStatementSource(
        tx,
        { companyId: f.company, businessId: f.business, period: '2026-11' },
        providers,
      ),
    );
  } finally {
    await db.close();
  }
};

describe('the open blocked corrections of the month (FR-027, CS-Q38)', () => {
  it('reads only the unresolved ones whose held month is this statement, and they move the input fingerprint', async () => {
    const before = (await readStatement(f, f.cookie)).body as unknown as View;
    const seed = (target: string, resolved: boolean, source: string) =>
      f.h.owner`INSERT INTO commission_blocked_corrections(
        company_id,id,business_id,employee_id,source_period,code,first_event_id,target_period,
        target_statement_id,created_at,resolved_at,resolved_generation)
        VALUES (${f.company},${ids.newId()},${f.business},${f.employee},${source},'NO_PLAN',
          ${ids.newId()},${target},${november},now(),${resolved ? new Date() : null},${resolved ? 1 : null})`;
    await seed('2026-11', false, '2026-09');
    await seed('2026-11', true, '2026-08');

    const source = await sourceWith();
    const after = (await readStatement(f, f.cookie)).body as unknown as View;

    expect(source.blocked).toEqual([
      { employeeId: f.employee, sourcePeriod: '2026-09', code: 'NO_PLAN' },
    ]);
    expect(after.current_fingerprint).not.toBe(before.current_fingerprint);
    expect(after.employees.find((entry) => entry.employee_id === f.employee)?.issues).toEqual([
      { kind: 'BLOCKED_CORRECTION', code: 'NO_PLAN', source_period: '2026-09' },
    ]);
  });
});

describe('the detail of a correction row (FR-033, D-20)', () => {
  it('loads the head of a cancelled line of an earlier month, so the correction keeps its service and customer', async () => {
    const db = createDatabase({ url: f.h.urls.app, ids });
    const lineId = await db.withTenant(f.company, async (tx) => {
      const id = await insertCommissionLineProjection(tx, f.tenant, ids, {
        businessDate: '2026-09-10',
        period: '2026-09',
        status: 'CANCELLED',
        net: '10.000',
        ruleKind: 'PCT',
        rulePctBps: 1000,
      });
      await insertCommissionCorrection(tx, f.tenant, ids, november, {
        sourcePeriod: '2026-09',
        sourceRef: `line:${id}`,
        sourceBusinessDate: '2026-09-10',
        attachedBranchIds: [f.branch],
      });
      return id;
    });
    await db.close();

    const view = (await readStatement(f, f.cookie)).body as unknown as View;
    const correction = view.employees
      .find((entry) => entry.employee_id === f.employee)
      ?.rows.find((row) => row.kind === 'CORRECTION');

    expect(lineId).toBeTruthy();
    expect(correction).toMatchObject({
      customer_name: expect.any(String),
      service_name_en: 'Estimate service',
    });
  });
});

describe('the names of everything the statement refers to (D-21)', () => {
  it('completes every referenced id with the placeholder when a reader finds no row, and the builder does not throw', async () => {
    const empty = {
      ...statementReaders().providers,
      branchNames: async () => new Map(),
      serviceNames: async () => new Map(),
      customerNames: async () => new Map(),
    };
    const source = await sourceWith(empty);

    const referencedServices = new Set(source.month.lines.map((line) => line.serviceId));
    expect([...source.names.services.keys()].sort()).toEqual(
      expect.arrayContaining([...referencedServices]),
    );
    for (const name of source.names.services.values()) {
      expect(name).toEqual({ nameAr: null, nameEn: MISSING_NAME_PLACEHOLDER });
    }
    for (const name of source.names.customers.values()) expect(name).toBe(MISSING_NAME_PLACEHOLDER);
    for (const name of source.names.branches.values()) {
      expect(name.nameEn).toBe(MISSING_NAME_PLACEHOLDER);
    }
    expect(() =>
      computeStatement('2026-11', source, new CanonicalSha256FingerprintHasher()),
    ).not.toThrow();
  });
});

describe('who is in scope of the statement (FR-033)', () => {
  const insertEmployee = async (name: string, hire: string, end: string | null, number: number) => {
    const id = ids.newId();
    await f.h.owner`INSERT INTO employees(
      company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,
      contract_end,employee_number)
      VALUES (${f.company},${id},${f.business},${f.branch},${name},${employeeNameMatchKey(name)},
        'staff',${hire}::date,${end}::date,${number})`;
    return id;
  };

  it('includes an employee whose employment overlaps the month and leaves out those who left or were not yet hired', async () => {
    const present = await insertEmployee('Present Pat', '2026-01-01', '2026-11-01', 20);
    const left = await insertEmployee('Left Lina', '2025-01-01', '2026-10-31', 21);
    const later = await insertEmployee('Later Lamya', '2026-12-01', null, 22);

    const view = (await readStatement(f, f.cookie)).body as unknown as View;
    const listed = view.employees.map((entry) => entry.employee_id);

    expect(listed).toContain(present);
    expect(listed).not.toContain(left);
    expect(listed).not.toContain(later);
  });

  it('includes an employee who left earlier but received a correction in the month', async () => {
    const leaver = await insertEmployee('Leaver Lubna', '2025-01-01', '2026-10-31', 23);
    const db = createDatabase({ url: f.h.urls.app, ids });
    await db.withTenant(f.company, (tx) =>
      insertCommissionCorrection(tx, { ...f.tenant, employee: leaver }, ids, november, {
        sourcePeriod: '2026-10',
        attachedBranchIds: [f.branch],
      }),
    );
    await db.close();

    const view = (await readStatement(f, f.cookie)).body as unknown as View;

    expect(view.employees.map((entry) => entry.employee_id)).toContain(leaver);
  });
});

describe('the salary revision in the input fingerprint (D-10)', () => {
  it('moves the input fingerprint when only the revision of a salary entry changes', async () => {
    const salary = ids.newId();
    await f.h.owner`INSERT INTO commission_salaries(
      company_id,id,business_id,employee_id,effective_from,amount,revision)
      VALUES (${f.company},${salary},${f.business},${f.employee},'2026-01-01'::date,300.000,1)`;
    const first = (await readStatement(f, f.cookie)).body as unknown as View;
    await f.h.owner`UPDATE commission_salaries SET revision=2 WHERE company_id=${f.company}
      AND id=${salary}`;
    const second = (await readStatement(f, f.cookie)).body as unknown as View;

    expect(second.current_fingerprint).not.toBe(first.current_fingerprint);
  });

  it('does not move the digest a reviewer without salary access receives when an amount changes under the same revision', async () => {
    const first = await readStatement(f, f.cookie);
    await f.h.owner`UPDATE commission_salaries SET amount=777.777 WHERE company_id=${f.company}
      AND employee_id=${f.employee}`;
    const second = await readStatement(f, f.cookie);

    expect((second.body as unknown as View).current_fingerprint).toBe(
      (first.body as unknown as View).current_fingerprint,
    );
    // لا المبلغ القديم ولا الجديد في الرد: البصمة مش بتحمل أي مبلغ راتب، والعرض ما بيعرضوش.
    expect(first.text + second.text).not.toMatch(/300.000|777.777/);
  });
});
