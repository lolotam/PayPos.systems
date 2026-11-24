import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { asReplicaOwner } from '../../../../../../packages/db/test/owner-cleanup.ts';
import {
  APPROVE,
  approvalFootprint,
  approve,
  approverMember,
  issueProof,
  openSwitch,
  reviewedStatement,
  type Approver,
} from './approve-statement.fixture.ts';
import {
  memberWithGrants,
  READ,
  readStatement,
  statementFixture,
  type StatementFixture,
} from './commission-statement.fixture.ts';

// ADR-0054 §7 و§10 (الاختبارات 10 و12): ترتيب الرفض الثلاثي، وأن الدمج وحده لا يفتح الاعتماد، والاعتماد الناجح وإعادته.
let f: StatementFixture;
let approver: Approver;
let fingerprints: { input: string; statement: string };

beforeAll(async () => {
  f = await statementFixture();
  approver = await approverMember(f, 'approver');
});

afterAll(async () => {
  await f?.h.close();
});

async function resetMonth(): Promise<void> {
  await f.h.owner`DELETE FROM company_feature_overrides WHERE company_id = ${f.company} AND flag = 'commission_statement_approval'`;
  await asReplicaOwner(f.h.owner, async (tx) => {
    await tx`DELETE FROM commission_coverage_proofs WHERE company_id = ${f.company}`;
    await tx`DELETE FROM commission_coverage_state WHERE company_id = ${f.company}`;
  });
}

describe('approval is closed until an operator opens it', () => {
  beforeEach(async () => {
    await resetMonth();
    fingerprints = await reviewedStatement(f, approver);
  });

  it('answers 403 FEATURE_DISABLED with no switch and no proof, and freezes nothing', async () => {
    const response = await approve(f, approver.cookie, 'closed-1', fingerprints);

    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FEATURE_DISABLED');
    expect((await approvalFootprint(f)).lines).toBe(0);
  });

  it('answers 422 COMMISSION_COVERAGE_NOT_PROVEN with the switch on and no proof, leaving no state row', async () => {
    await openSwitch(f, approver.userId);

    const response = await approve(f, approver.cookie, 'closed-2', fingerprints);

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('COMMISSION_COVERAGE_NOT_PROVEN');
    expect(await approvalFootprint(f)).toMatchObject({ status: 'REVIEWED', lines: 0, audits: 0 });
    const [state] = await f.h.owner`SELECT count(*)::int AS n FROM commission_coverage_state
      WHERE company_id = ${f.company}`;
    expect(state?.['n']).toBe(0);
  });

  it('answers 403 FEATURE_DISABLED for a proof with the switch off: a proof alone opens nothing', async () => {
    await issueProof(f);

    const response = await approve(f, approver.cookie, 'closed-3', fingerprints);

    expect((response.body as { code: string }).code).toBe('FEATURE_DISABLED');
    const [state] = await f.h.owner`SELECT count(*)::int AS n FROM commission_coverage_state
      WHERE company_id = ${f.company}`;
    expect(state?.['n']).toBe(1);
  });

  it('refuses a proof that an invalidation made not current', async () => {
    await issueProof(f);
    await openSwitch(f, approver.userId);
    await f.h.owner`UPDATE commission_coverage_state SET generation = generation + 1, reason = 'TEST'
      WHERE company_id = ${f.company}`;

    const response = await approve(f, approver.cookie, 'closed-4', fingerprints);

    expect((response.body as { code: string }).code).toBe('COMMISSION_COVERAGE_NOT_PROVEN');
  });

  it('never lets the plan flag open it: only an explicit override does', async () => {
    await f.h.owner`UPDATE plans SET feature_flags = feature_flags || '{"commission_statement_approval": true}'::jsonb`;
    await issueProof(f);

    const response = await approve(f, approver.cookie, 'closed-5', fingerprints);

    expect((response.body as { code: string }).code).toBe('FEATURE_DISABLED');
  });
});

describe('the uniform refusals come first', () => {
  beforeEach(async () => {
    await resetMonth();
    fingerprints = await reviewedStatement(f, approver);
  });

  it('answers 403 FORBIDDEN, never 422, to a reader without the approve permission even with no proof', async () => {
    const reader = await memberWithGrants(f, 'reader-only', [{ permission: READ, scope: 'BUSINESS' }]);

    const response = await approve(f, reader.cookie, 'forbidden-1', fingerprints);

    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
  });

  it('refuses a branch grant of the approve permission, since approval is business-wide only (CM-38b)', async () => {
    const branch = await memberWithGrants(f, 'branch-approver', [
      { permission: APPROVE, scope: 'BRANCH' },
      { permission: READ, scope: 'BRANCH' },
    ]);
    await openSwitch(f, approver.userId);
    await issueProof(f);

    const response = await approve(f, branch.cookie, 'forbidden-2', fingerprints);

    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
    expect(await approvalFootprint(f)).toMatchObject({ status: 'REVIEWED', lines: 0, audits: 0 });
  });

  it('refuses branch grants that cover every branch of the business too (CM-38b)', async () => {
    const everyBranch = await memberWithGrants(f, 'every-branch-approver', [
      { permission: APPROVE, scope: 'BRANCH' },
      { permission: APPROVE, scope: 'SECOND_BRANCH' },
      { permission: READ, scope: 'BRANCH' },
      { permission: READ, scope: 'SECOND_BRANCH' },
    ]);
    await openSwitch(f, approver.userId);
    await issueProof(f);

    const response = await approve(f, everyBranch.cookie, 'forbidden-4', fingerprints);

    expect(response.status).toBe(403);
    expect((response.body as { code: string }).code).toBe('FORBIDDEN');
    expect(await approvalFootprint(f)).toMatchObject({ status: 'REVIEWED', lines: 0, audits: 0 });
  });

  it('refuses a very old month that was never generated with 409 COMMISSION_STATEMENT_NOT_REVIEWED', async () => {
    const response = await approve(f, approver.cookie, 'ancient-1', fingerprints, '0001-01');

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('COMMISSION_STATEMENT_NOT_REVIEWED');
  });

  it('answers 422 COMMISSION_PERIOD_NOT_ENDED for a month that has not ended', async () => {
    const response = await approve(f, approver.cookie, 'forbidden-3', fingerprints, '2026-12');

    expect(response.status).toBe(422);
    expect((response.body as { code: string }).code).toBe('COMMISSION_PERIOD_NOT_ENDED');
  });
});

describe('a month with every condition met', () => {
  beforeAll(async () => {
    await resetMonth();
    fingerprints = await reviewedStatement(f, approver);
    await openSwitch(f, approver.userId);
    await issueProof(f);
  });

  it('refuses a stale fingerprint before freezing anything', async () => {
    const stale = { ...fingerprints, input: 'a'.repeat(64) };

    const response = await approve(f, approver.cookie, 'ok-stale', stale);

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('COMMISSION_FINGERPRINT_STALE');
    expect(await approvalFootprint(f)).toMatchObject({ status: 'REVIEWED', lines: 0, audits: 0 });
  });

  it('approves, freezes the rows, audits once, and reads the same month back from the frozen rows', async () => {
    const response = await approve(f, approver.cookie, 'ok-approve', fingerprints);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      reader_scope: 'BUSINESS',
      status: 'APPROVED',
      input_fingerprint: fingerprints.input,
      statement_fingerprint: fingerprints.statement,
    });
    const footprint = await approvalFootprint(f);
    expect(footprint).toMatchObject({ status: 'APPROVED', audits: 1 });
    expect(footprint.lines).toBeGreaterThan(0);

    const read = await readStatement(f, approver.cookie);
    expect(read.status).toBe(200);
    expect((read.body as { employees: unknown }).employees).toEqual(
      (response.body as { employees: unknown }).employees,
    );
  });

  it('returns the original success to a retry with the same key and payload, without a second audit', async () => {
    const first = await approve(f, approver.cookie, 'ok-approve', fingerprints);

    expect(first.status).toBe(200);
    expect((await approvalFootprint(f)).audits).toBe(1);
  });

  it('answers 409 COMMISSION_PERIOD_CLOSED to a new key on an approved month', async () => {
    const response = await approve(f, approver.cookie, 'ok-second', fingerprints);

    expect(response.status).toBe(409);
    expect((response.body as { code: string }).code).toBe('COMMISSION_PERIOD_CLOSED');
  });
});
