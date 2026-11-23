import { createDatabase, lockStatementPeriods } from '@pospay/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { asReplicaOwner } from '../../../../../../packages/db/test/owner-cleanup.ts';
import { eventId, pendingCountHarness } from '../../../../../../packages/db/test/statement-pending-fixtures.ts';
import { insertApprovalCarries } from '../persistence/approval-carries.ts';
import { freezeStatementRows } from '../persistence/approval-freeze.ts';
import {
  approvalFootprint,
  approve,
  approverMember,
  issueProof,
  openSwitch,
  reviewedStatement,
  type Approver,
} from './approve-statement.fixture.ts';
import { ids, statementFixture, type StatementFixture } from './commission-statement.fixture.ts';

// ADR-0012 المجموعة 5 (CM-35) والمرحّلات (D-22): العدّاد يرفض الاعتماد ولا يجمّد شيئًا، وكتابة المرحّلات والتجميد
// بصيغتها الفعلية على قاعدة بيانات حقيقية.
let f: StatementFixture;
let approver: Approver;

beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'pending-approver');
});

afterAll(async () => {
  await f?.h.close();
});

const harness = () =>
  pendingCountHarness(
    () => f.h.owner,
    () => f.h.owner,
  );

describe('a pending commission event (CM-35)', () => {
  beforeEach(async () => {
    await asReplicaOwner(f.h.owner, async (tx) => {
      await tx`DELETE FROM commission_coverage_proofs WHERE company_id = ${f.company}`;
      await tx`DELETE FROM commission_coverage_state WHERE company_id = ${f.company}`;
      await tx`DELETE FROM outbox WHERE company_id = ${f.company}`;
    });
    await f.h.owner`DELETE FROM consumed_events WHERE company_id = ${f.company}`;
    await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id = ${f.company} AND flag = 'commission_statement_approval'`;
  });

  it('refuses with 409 COMMISSION_UPDATES_PENDING and freezes nothing, then approves once the event is marked', async () => {
    const { seedEvent, markEvent } = harness();
    const fingerprints = await reviewedStatement(f, approver);
    await openSwitch(f, approver.userId);
    await issueProof(f);
    await seedEvent(f.company, eventId(7001), 'SalaryChanged');

    const refused = await approve(f, approver.cookie, 'pending-1', fingerprints);

    expect(refused.status).toBe(409);
    expect((refused.body as { code: string }).code).toBe('COMMISSION_UPDATES_PENDING');
    expect(await approvalFootprint(f)).toMatchObject({ status: 'REVIEWED', lines: 0, audits: 0 });

    await markEvent(f.company, eventId(7001));
    const approved = await approve(f, approver.cookie, 'pending-2', fingerprints);

    expect(approved.status).toBe(200);
  });

  it('keeps a parked event pending, since a retry cannot discharge what was never consumed', async () => {
    const { seedEvent } = harness();
    const fingerprints = await reviewedStatement(f, approver);
    await openSwitch(f, approver.userId);
    await issueProof(f);
    await seedEvent(f.company, eventId(7002), 'PackageSaleChanged', { parked: true });

    const refused = await approve(f, approver.cookie, 'pending-3', fingerprints);

    expect((refused.body as { code: string }).code).toBe('COMMISSION_UPDATES_PENDING');
  });
});

describe('the carry and freeze statements', () => {
  let database: ReturnType<typeof createDatabase>;
  beforeAll(() => {
    database = createDatabase({ url: f.h.urls.app, ids });
  });
  afterAll(async () => {
    await database.close();
  });

  it('writes one carry per kind and employee with the negative amount and both statements', async () => {
    await database.withTenant(f.company, async (tx) => {
      const [source, target] = await lockStatementPeriods(tx, {
        businessId: f.business,
        periods: ['2026-08', '2026-09'],
        ids,
      });
      if (source === undefined || target === undefined) throw new Error('the periods were not locked');
      await insertApprovalCarries(tx, ids, f.business, source.statementId, '2026-08', [
        { employeeId: f.employee, kind: 'COMMISSION', amount: -9_000n, targetPeriod: '2026-09', targetStatementId: target.statementId },
        { employeeId: f.employee, kind: 'TIP_CARD', amount: -1_250n, targetPeriod: '2026-09', targetStatementId: target.statementId },
      ]);
    });

    const rows = await f.h.owner`SELECT kind, amount::text AS amount, source_period, target_period
      FROM commission_carries WHERE company_id = ${f.company} AND source_period = '2026-08' ORDER BY kind`;
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { kind: 'COMMISSION', amount: '-9.000', source_period: '2026-08', target_period: '2026-09' },
      { kind: 'TIP_CARD', amount: '-1.250', source_period: '2026-08', target_period: '2026-09' },
    ]);
  });

  it('refuses a second carry of the same kind for the same employee in the same source statement', async () => {
    const again = database.withTenant(f.company, async (tx) => {
      const [source, target] = await lockStatementPeriods(tx, {
        businessId: f.business,
        periods: ['2026-08', '2026-09'],
        ids,
      });
      if (source === undefined || target === undefined) throw new Error('the periods were not locked');
      await insertApprovalCarries(tx, ids, f.business, source.statementId, '2026-08', [
        { employeeId: f.employee, kind: 'COMMISSION', amount: -1_000n, targetPeriod: '2026-09', targetStatementId: target.statementId },
      ]);
    });

    await expect(again).rejects.toThrow(/commission_carries_source_key|duplicate key/);
  });

  it('refuses to freeze rows into a statement that is not being approved by this transaction', async () => {
    const freezing = database.withTenant(f.company, async (tx) => {
      const [draft] = await lockStatementPeriods(tx, {
        businessId: f.business,
        periods: ['2026-07'],
        ids,
      });
      if (draft === undefined) throw new Error('the period was not locked');
      await freezeStatementRows(tx, ids, { userId: approver.userId, businessId: f.business }, draft.statementId, [], [
        { employeeId: f.employee, branchId: f.branch, attachedFrom: '2026-07-01', attachedTo: '2026-07-31' },
      ]);
    });

    await expect(freezing).rejects.toThrow(/frozen_by_approval|frozen only by the transaction/);
  });
});
