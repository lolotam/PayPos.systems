import { describe, expect, it } from 'vitest';

import type { ApprovalLockedPeriod } from '../ports/commission-statement-approve.port.ts';
import type { CommissionStatementSource } from '../ports/commission-statement.port.ts';
import {
  hasher,
  PROOF,
  oct,
  NOV_DRAFT,
  reviewedSource,
  recordingScope,
  run,
  refusal,} from './approve-statement.usecase.fixture.ts';
import { PERIOD, RANA, statementRecord } from './statement-source.fixture.ts';
import { computeStatement } from '../use-cases/compute-statement-view/compute-statement-view.ts';

describe('approving a reviewed month (CM-34, ADR-0054 section 7)', () => {
  it('runs the steps in the mandated order and returns the frozen statement', async () => {
    const { source, command } = reviewedSource();
    const { scope, calls } = recordingScope({ source });

    const view = await run(scope, command);

    expect(calls).toEqual([
      'recheckAccess',
      'cutoff',
      'localToday',
      'readStatementStatus',
      'lockPeriods:2026-10,2026-11',
      'recheckAccess',
      'readCoverageGate',
      'readSource',
      'readLineShares',
      'countPendingEvents',
      'readEmployment',
      'markApproved',
      'freeze',
      'readFrozen',
      'writeCarries',
      'audit',
    ]);
    expect(view).toMatchObject({ reader_scope: 'BUSINESS', status: 'APPROVED', period: PERIOD });
    expect(view.employees.map((employee) => employee.employee_id)).toEqual([RANA]);
  });

  it('freezes an empty month as one zero EMPLOYEE row per in-scope employee (CM-34c)', async () => {
    const { source, command } = reviewedSource();
    const { scope } = recordingScope({ source });

    const view = await run(scope, command);

    expect(view.employees).toHaveLength(1);
    expect(view.employees[0]).toMatchObject({
      commission_subtotal: '0.000',
      payable: '0.000',
      rows: [],
    });
  });
});

describe('the three refusals keep their precedence under the state-row lock', () => {
  it('answers FEATURE_DISABLED before it looks at the proof, with nothing frozen', async () => {
    const { source, command } = reviewedSource();
    const { scope, calls } = recordingScope({ source, switchEnabled: false, proof: null });

    expect((await refusal(run(scope, command)))?.code).toBe('FEATURE_DISABLED');
    expect(calls).not.toContain('readSource');
    expect(calls).not.toContain('freeze');
  });

  it('answers COMMISSION_COVERAGE_NOT_PROVEN before a stale fingerprint or a pending count', async () => {
    const { source, command } = reviewedSource();
    const stale = { ...command, expectedFingerprint: 'f'.repeat(64) };
    const { scope } = recordingScope({ source, proof: null, pending: 3 });

    expect((await refusal(run(scope, stale)))?.code).toBe('COMMISSION_COVERAGE_NOT_PROVEN');
  });

  it.each([
    { name: 'another version', proof: { ...PROOF, version: 2 } },
    { name: 'a business absent from the proof', proof: { ...PROOF, businessIds: [] } },
    { name: 'a range that misses the month start', proof: { ...PROOF, tipFrom: '2026-10-15' } },
  ])('refuses a proof with $name as not proven', async ({ proof }) => {
    const { source, command } = reviewedSource();
    const { scope, calls } = recordingScope({ source, proof });

    expect((await refusal(run(scope, command)))?.code).toBe('COMMISSION_COVERAGE_NOT_PROVEN');
    expect(calls).not.toContain('markApproved');
  });

  it('answers COMMISSION_UPDATES_PENDING last, after every other check passed', async () => {
    const { source, command } = reviewedSource();
    const { scope, calls } = recordingScope({ source, pending: 2 });

    expect((await refusal(run(scope, command)))?.code).toBe('COMMISSION_UPDATES_PENDING');
    expect(calls.at(-1)).toBe('countPendingEvents');
  });
});

describe('the checks before the lock and the status', () => {
  it('refuses a month that has not ended before it locks anything (CM-38)', async () => {
    const { source, command } = reviewedSource();
    const { scope, calls } = recordingScope({ source, today: '2026-10-20' });

    expect((await refusal(run(scope, command)))?.code).toBe('COMMISSION_PERIOD_NOT_ENDED');
    expect(calls.some((call) => call.startsWith('lockPeriods'))).toBe(false);
  });

  it('gives the uniform FORBIDDEN, and nothing else, when the business does not exist', async () => {
    const { source, command } = reviewedSource();
    const { scope } = recordingScope({ source, today: null });

    expect((await refusal(run(scope, command)))?.code).toBe('FORBIDDEN');
  });

  it.each([
    ['an approved month', 'APPROVED', 'COMMISSION_PERIOD_CLOSED'],
    ['a paid month', 'PAID', 'COMMISSION_PERIOD_CLOSED'],
    ['a draft month', 'DRAFT', 'COMMISSION_STATEMENT_NOT_REVIEWED'],
    ['a month never generated', null, 'COMMISSION_STATEMENT_NOT_REVIEWED'],
  ] as const)('refuses %s before it locks any month in between', async (_label, preStatus, code) => {
    const { source, command } = reviewedSource();
    const { scope, calls } = recordingScope({ source, preStatus });

    expect((await refusal(run(scope, command)))?.code).toBe(code);
    expect(calls.some((call) => call.startsWith('lockPeriods'))).toBe(false);
  });

  it('refuses an approved month with COMMISSION_PERIOD_CLOSED (CM-37, the second approver)', async () => {
    const { source, command } = reviewedSource();
    const locked: ApprovalLockedPeriod[] = [oct('APPROVED'), NOV_DRAFT];
    const { scope } = recordingScope({ source, locked });

    expect((await refusal(run(scope, command)))?.code).toBe('COMMISSION_PERIOD_CLOSED');
  });

  it('refuses a statement returned to DRAFT while the approval waited (CM-37)', async () => {
    const { source, command } = reviewedSource();
    const locked: ApprovalLockedPeriod[] = [oct('DRAFT'), NOV_DRAFT];
    const { scope, calls } = recordingScope({ source, locked });

    expect((await refusal(run(scope, command)))?.code).toBe('COMMISSION_STATEMENT_NOT_REVIEWED');
    expect(calls).not.toContain('readCoverageGate');
  });

  it('gives a permission revoked while waiting the uniform 403 before any status or coverage answer', async () => {
    const { source, command } = reviewedSource();
    const locked: ApprovalLockedPeriod[] = [oct('APPROVED'), NOV_DRAFT];
    const { scope } = recordingScope({ source, locked, accessAfterLock: 'FORBIDDEN', proof: null });

    expect((await refusal(run(scope, command)))?.code).toBe('FORBIDDEN');
  });
});

describe('fingerprints (CM-31, CM-34e)', () => {
  it('refuses a stale input fingerprint with the current pair and return_required', async () => {
    const { source, command } = reviewedSource();
    const { scope } = recordingScope({ source });

    const error = await refusal(run(scope, { ...command, expectedFingerprint: 'e'.repeat(64) }));

    expect(error?.code).toBe('COMMISSION_FINGERPRINT_STALE');
    expect(error?.details).toMatchObject({ changed: 'INPUTS', return_required: true });
  });

  it('refuses a stale statement fingerprint as a STATEMENT change', async () => {
    const { source, command } = reviewedSource();
    const { scope } = recordingScope({ source });

    const error = await refusal(
      run(scope, { ...command, expectedStatementFingerprint: 'd'.repeat(64) }),
    );

    expect(error?.details).toMatchObject({ changed: 'STATEMENT' });
  });

  it('refuses when the frozen rows hash differently, before it writes carries or audit', async () => {
    const { source, command } = reviewedSource();
    const { scope, calls } = recordingScope({ source, tamperFrozen: true });

    expect((await refusal(run(scope, command)))?.code).toBe('COMMISSION_FINGERPRINT_STALE');
    expect(calls).not.toContain('writeCarries');
    expect(calls).not.toContain('audit');
  });
});

/** مصادر بصمتاها المحسوبتان هما بصمتا المراجعة نفسهما، لعزل المانع كسبب الرفض الوحيد. */
function reviewedOf(source: CommissionStatementSource) {
  const computed = computeStatement(PERIOD, source, hasher);
  const reviewed = {
    ...source,
    statement: statementRecord({
      status: 'REVIEWED',
      reviewedFingerprint: computed.inputFingerprint,
      reviewedStatementFingerprint: computed.statementFingerprint,
    }),
  };
  return { computed, reviewed };
}

describe('blocking issues (FR-027)', () => {
  it('refuses a month with an open blocked correction, listing it by employee', async () => {
    const { source, command } = reviewedSource();
    const blocked: CommissionStatementSource = {
      ...source,
      blocked: [{ employeeId: RANA, sourcePeriod: '2026-09', code: 'NO_PLAN' }],
    };
    // الكشف اتراجع بالمانع نفسه موجود (حالة سباق)، فالبصمتان مطابقتان والمانع هو اللي بيرفض.
    const { computed, reviewed } = reviewedOf(blocked);
    const { scope, calls } = recordingScope({ source: reviewed });

    const error = await refusal(
      run(scope, {
        ...command,
        expectedFingerprint: computed.inputFingerprint,
        expectedStatementFingerprint: computed.statementFingerprint,
      }),
    );

    expect(error?.code).toBe('COMMISSION_STATEMENT_BLOCKED');
    expect(error?.details).toEqual({ issues: [{ employee_id: RANA, code: 'NO_PLAN' }] });
    expect(calls).not.toContain('countPendingEvents');
  });

});

describe('blocking issues of employees outside the statement', () => {
  it('refuses a month whose only blocker belongs to a former employee outside the statement (block-only, PR #1254)', async () => {
    const { source, command } = reviewedSource();
    const FORMER = '0198aaaa-0000-7000-8000-0000000000f9';
    const blocked: CommissionStatementSource = {
      ...source,
      blocked: [{ employeeId: FORMER, sourcePeriod: '2026-09', code: 'NO_SALARY' }],
      unlisted: [{ employeeId: FORMER, employeeNumber: 9, nameAr: null, nameEn: 'Former' }],
    };
    const { computed, reviewed } = reviewedOf(blocked);
    const { scope } = recordingScope({ source: reviewed });

    const error = await refusal(
      run(scope, {
        ...command,
        expectedFingerprint: computed.inputFingerprint,
        expectedStatementFingerprint: computed.statementFingerprint,
      }),
    );

    expect(error?.code).toBe('COMMISSION_STATEMENT_BLOCKED');
    expect(error?.details).toEqual({ issues: [{ employee_id: FORMER, code: 'NO_SALARY' }] });
  });

});

describe('a blocker that appears after the review', () => {
  it('refuses a fingerprint that moved because a blocker appeared after the review (the stale answer wins)', async () => {
    const { source, command } = reviewedSource();
    const blocked: CommissionStatementSource = {
      ...source,
      blocked: [{ employeeId: RANA, sourcePeriod: '2026-09', code: 'NO_PLAN' }],
    };
    const { scope } = recordingScope({ source: blocked });

    expect((await refusal(run(scope, command)))?.code).toBe('COMMISSION_FINGERPRINT_STALE');
  });
});

describe('carries of negative balances (D-22)', () => {
  it('writes the carry into the earliest DRAFT month after the source, skipping a REVIEWED one', async () => {
    const { source, command } = reviewedSource(true);
    const locked: ApprovalLockedPeriod[] = [
      oct('REVIEWED'),
      { period: '2026-11', statementId: 'st-nov', status: 'REVIEWED' },
      { period: '2026-12', statementId: 'st-dec', status: 'DRAFT' },
    ];
    const { scope, carries } = recordingScope({ source, locked, today: '2026-12-10' });

    await run(scope, command);

    expect(carries).toEqual([
      {
        employeeId: RANA,
        kind: 'COMMISSION',
        amount: -9000n,
        targetPeriod: '2026-12',
        targetStatementId: 'st-dec',
      },
    ]);
  });

  it('does not re-carry a departed employee', async () => {
    const { source, command } = reviewedSource(true);
    const { scope, carries } = recordingScope({ source, departed: true });

    await run(scope, command);

    expect(carries).toEqual([]);
  });
});
