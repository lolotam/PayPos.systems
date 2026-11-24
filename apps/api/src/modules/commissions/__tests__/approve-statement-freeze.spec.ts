import { createDatabase, type TenantWrappers, type Tx } from '@pospay/db';
import { employeeNameMatchKey } from '@pospay/domain';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  lockTargetStatement,
  insertCommissionCorrection,
} from '../../../../../../packages/db/test/commission-correction-fixtures.ts';
import {
  businessCalendar,
  pendingCommissionEvents,
  readCommissionApproveAccess,
  readEmployeeEmploymentDates,
  readExplicitCompanyFeature,
} from '../../../../test/harness.ts';
import { CanonicalSha256FingerprintHasher } from '../persistence/canonical-sha256-fingerprint-hasher.ts';
import type { CommissionStatementApproveReaders } from '../persistence/commission-statement-approve-scope.ts';
import { createCommissionStatementApproveTransactions } from '../persistence/drizzle-commission-statement-approve-transactions.ts';
import { ApproveCommissionStatementUseCase } from '../use-cases/approve-statement/approve-statement.usecase.ts';
import {
  approvalFootprint,
  approveReviewedMonth,
  approve,
  approverMember,
  issueProof,
  openSwitch,
  resetCoverage,
  resetStatementToDraft,
  reviewedStatement,
  type Approver,
} from './approve-statement.fixture.ts';
import {
  ids,
  PERIOD,
  readStatement,
  statementFixture,
  statementReaders,
  type StatementFixture,
} from './commission-statement.fixture.ts';

// CM-34 (التراجع عند فشل التجميد) وCM-34d (لقطة ارتباط الفروع المقصوصة، والتصحيح المستلم بقيمه القديمة والجديدة والفرق).
// الشهر يُعاد إلى DRAFT بين الاختبارات بوضع replica للمالك، فكل اختبار يعتمد الشهر من جديد.
let f: StatementFixture;
let approver: Approver;
let mona = '';

beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'freeze-approver');
  mona = ids.newId();
  await f.h.owner`INSERT INTO employees(
    company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES (${f.company},${mona},${f.business},${f.branch},'Mona Transfer',
      ${employeeNameMatchKey('Mona Transfer')},'staff','2026-01-01',40)`;
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to")
    VALUES (${f.company},${ids.newId()},${f.business},${mona},${f.branch},'2026-01-01'::date,'2026-11-15'::date),
           (${f.company},${ids.newId()},${f.business},${mona},${f.secondBranch},'2026-11-15'::date,NULL)`;
});

afterAll(async () => {
  await f?.h.close();
});

/** الشركة والنشاط والشهر في حالة REVIEWED بلا أي أثر اعتماد سابق. */
async function freshReviewedMonth() {
  await resetStatementToDraft(f);
  await resetCoverage(f);
  const fingerprints = await reviewedStatement(f, approver);
  await openSwitch(f, approver.userId);
  await issueProof(f);
  return fingerprints;
}

/** غلاف يفشل عند أول جملة تحمل العلامة، بعد أن تكون الجمل السابقة نُفذت فعلًا في نفس المعاملة. */
function failingAt(database: TenantWrappers, marker: string): TenantWrappers {
  const dialect = new PgDialect();
  const wrapped = Object.create(database) as TenantWrappers;
  wrapped.withTenant = (companyId, work, options) =>
    database.withTenant(
      companyId,
      (tx) =>
        work(
          new Proxy(tx, {
            get(target, prop) {
              const value: unknown = Reflect.get(target, prop, target);
              if (prop !== 'execute') {
                return typeof value === 'function' ? value.bind(target) : value;
              }
              return (query: SQL) =>
                dialect.sqlToQuery(query).sql.includes(marker)
                  ? Promise.reject(new Error('injected freeze failure'))
                  : (value as (q: SQL) => unknown).call(target, query);
            },
          }) as Tx,
        ),
      options,
    );
  return wrapped;
}

function approveReaders(): CommissionStatementApproveReaders {
  return {
    businessCalendar,
    approveAccess: readCommissionApproveAccess,
    explicitFeature: readExplicitCompanyFeature,
    employment: { employmentDates: readEmployeeEmploymentDates },
    pending: pendingCommissionEvents,
    providers: statementReaders().providers,
    clock: { now: () => new Date('2026-12-02T09:00:00Z') },
  };
}

describe('a failure while freezing rolls everything back (CM-34)', () => {
  it.each([
    ['the frozen lines are inserted, after the status moved to APPROVED', 'INSERT INTO commission_statement_lines', 'lines'],
    ['the audit entry is written, after every freeze and carry write', 'INSERT INTO audit_log', 'audit'],
  ])('leaves the month REVIEWED with no lines, carries or audit when it fails as %s', async (_label, marker, name) => {
    const fingerprints = await freshReviewedMonth();
    const auditsBefore = (await approvalFootprint(f)).audits;
    const database = createDatabase({ url: f.h.urls.app, ids });
    try {
      const useCase = new ApproveCommissionStatementUseCase(
        createCommissionStatementApproveTransactions(failingAt(database, marker), ids, approveReaders()),
        new CanonicalSha256FingerprintHasher(),
      );

      await expect(
        useCase.execute({
          companyId: f.company,
          userId: approver.userId,
          businessId: f.business,
          period: PERIOD,
          expectedFingerprint: fingerprints.input,
          expectedStatementFingerprint: fingerprints.statement,
          key: `fault-${name}`,
          fingerprint: 'f'.repeat(64),
        }),
      ).rejects.toThrow('injected freeze failure');
    } finally {
      await database.close();
    }

    // سجل التدقيق للإضافة فقط فلا يُمسح بين الاختبارات؛ المقارنة بما كان قبل المحاولة الفاشلة.
    expect(await approvalFootprint(f)).toMatchObject({
      status: 'REVIEWED',
      lines: 0,
      audits: auditsBefore,
      carries: 0,
    });
    const [stored] = await f.h.owner`SELECT input_fingerprint, statement_fingerprint, approved_by, approved_at
      FROM commission_statements
      WHERE company_id = ${f.company} AND business_id = ${f.business} AND period = ${PERIOD}`;
    expect(stored).toEqual({
      input_fingerprint: null,
      statement_fingerprint: null,
      approved_by: null,
      approved_at: null,
    });
    // مفتاح جديد لكل محاولة كي لا يكون الرد ردًّا مخزّنًا من حالة سابقة، ثم نثبت أن المعالج نفّذ فعلًا (اعتماد وتدقيق جديد).
    const retry = await approve(f, approver.cookie, `fault-retry-${name}`, fingerprints);
    expect(retry.status).toBe(200);
    expect(await approvalFootprint(f)).toMatchObject({ status: 'APPROVED', audits: auditsBefore + 1 });
  });
});

describe('the frozen snapshot of a transferred employee (CM-34d)', () => {
  it('keeps two clipped attachment rows that a later branch edit cannot change', async () => {
    await resetStatementToDraft(f);
    await resetCoverage(f);
    const { response } = await approveReviewedMonth(f, approver, 'freeze-transfer');
    expect(response.status).toBe(200);
    const attachments = () => f.h.owner`SELECT branch_id, attached_from::text AS attached_from,
        attached_to::text AS attached_to FROM commission_statement_attachments
      WHERE company_id = ${f.company} AND employee_id = ${mona} ORDER BY attached_from`;
    const employeeRow = () => f.h.owner`SELECT attached_branch_ids FROM commission_statement_lines
      WHERE company_id = ${f.company} AND employee_id = ${mona} AND kind = 'EMPLOYEE'`;

    const before = { attachments: await attachments(), row: await employeeRow() };

    expect(before.attachments.map((row) => ({ ...row }))).toEqual([
      { branch_id: f.branch, attached_from: '2026-11-01', attached_to: '2026-11-14' },
      { branch_id: f.secondBranch, attached_from: '2026-11-15', attached_to: '2026-11-30' },
    ]);
    expect([...((before.row[0]?.['attached_branch_ids'] as string[]) ?? [])].sort()).toEqual(
      [f.branch, f.secondBranch].sort(),
    );

    await f.h.owner`UPDATE employee_branches SET "to" = '2026-11-20'::date
      WHERE company_id = ${f.company} AND employee_id = ${mona} AND branch_id = ${f.secondBranch}
        AND "to" IS NULL`;

    expect(await attachments()).toEqual(before.attachments);
    expect(await employeeRow()).toEqual(before.row);
    const closed = await readStatement(f, approver.cookie);
    expect(closed.status).toBe(200);
    expect((closed.body as { employees: unknown }).employees).toEqual(
      (response.body as { employees: unknown }).employees,
    );
  });
});

describe('a correction received by the month (CM-34d)', () => {
  it('freezes with the previous amount, the new amount and the delta', async () => {
    await resetStatementToDraft(f);
    await resetCoverage(f);
    const database = createDatabase({ url: f.h.urls.app, ids });
    try {
      const november = await lockTargetStatement({
        db: database,
        companyId: f.company,
        businessId: f.business,
        period: PERIOD,
        ids,
      });
      await database.withTenant(f.company, (tx) =>
        insertCommissionCorrection(tx, f.tenant, ids, november, {
          targetPeriod: PERIOD,
          attachedBranchIds: [f.branch],
          amount: '5.000',
          previousAmount: '10.000',
          newAmount: '15.000',
        }),
      );
    } finally {
      await database.close();
    }

    const { response } = await approveReviewedMonth(f, approver, 'freeze-correction');

    expect([response.status, (response.body as { code?: string }).code]).toEqual([200, undefined]);
    const frozen = await f.h.owner`SELECT kind, previous_amount::text AS previous_amount,
        new_amount::text AS new_amount, amount::text AS amount, source_period
      FROM commission_statement_lines
      WHERE company_id = ${f.company} AND kind = 'CORRECTION'`;
    expect(frozen.map((row) => ({ ...row }))).toEqual([
      { kind: 'CORRECTION', previous_amount: '10.000', new_amount: '15.000', amount: '5.000', source_period: '2026-10' },
    ]);
  });
});

describe('a statement whose totals exceed one numeric(14,3) row', () => {
  it('approves and answers 200 with the large total, instead of committing and then failing the response', async () => {
    await resetStatementToDraft(f);
    await resetCoverage(f);
    const database = createDatabase({ url: f.h.urls.app, ids });
    try {
      const november = await lockTargetStatement({
        db: database,
        companyId: f.company,
        businessId: f.business,
        period: PERIOD,
        ids,
      });
      for (let copy = 0; copy < 2; copy += 1) {
        await database.withTenant(f.company, (tx) =>
          insertCommissionCorrection(tx, f.tenant, ids, november, {
            targetPeriod: PERIOD,
            attachedBranchIds: [f.branch],
            amount: '99999999999.000',
            previousAmount: '0.000',
            newAmount: '99999999999.000',
          }),
        );
      }
    } finally {
      await database.close();
    }

    const { response } = await approveReviewedMonth(f, approver, 'freeze-large-total');

    expect([response.status, (response.body as { code?: string }).code]).toEqual([200, undefined]);
    const employee = (response.body as { employees: { employee_id: string; payable: string }[] }).employees.find(
      (candidate) => candidate.employee_id === f.employee,
    );
    // 12 خانة صحيحة: أكبر مما يتسع له صف واحد (11 خانة)، وهو مجموع صفي التصحيح وبقية صفوف الشهر.
    expect(employee?.payable).toMatch(/^[1-9]\d{11}\.\d{3}$/);
    const replay = await approve(f, approver.cookie, 'freeze-large-total', {
      input: (response.body as { input_fingerprint: string }).input_fingerprint,
      statement: (response.body as { statement_fingerprint: string }).statement_fingerprint,
    });
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(response.body);
  });
});
