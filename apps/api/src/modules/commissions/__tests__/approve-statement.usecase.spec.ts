import { describe, expect, it } from 'vitest';

import type { StoredCoverageProof } from '../domain/coverage-proof.ts';
import { CommissionPlanVersionError } from '../domain/errors.ts';
import { CanonicalSha256FingerprintHasher } from '../persistence/canonical-sha256-fingerprint-hasher.ts';
import type {
  ApprovalLockedPeriod,
  CarryWrite,
  CommissionStatementApproveCommand,
  CommissionStatementApproveScope,
  CommissionStatementApproveTransactions,
  FrozenStatementRead,
} from '../ports/commission-statement-approve.port.ts';
import type { CommissionStatementSource } from '../ports/commission-statement.port.ts';
import { ApproveCommissionStatementUseCase } from '../use-cases/approve-statement/approve-statement.usecase.ts';
import { computeStatement } from '../use-cases/compute-statement-view/compute-statement-view.ts';
import {
  BUSINESS,
  PERIOD,
  RANA,
  statementRecord,
  statementSource,
} from './statement-source.fixture.ts';

const hasher = new CanonicalSha256FingerprintHasher();
const TYPES = ['SalaryChanged', 'SessionTipsChanged'];
const RULES = {
  version: 1,
  countedTypes: TYPES,
  consumerId: 'commissions.project-inputs',
  databaseName: 'pospay_staging',
  systemId: '7301234567890123456',
};
const PROOF: StoredCoverageProof = {
  version: 1,
  businessIds: [BUSINESS],
  tipFrom: '2026-01-01',
  tipTo: '2026-11-23',
  tipDayBound: '2026-11-23',
  countedTypes: TYPES,
  consumerId: 'commissions.project-inputs',
  databaseName: 'pospay_staging',
  systemId: '7301234567890123456',
};
const oct = (status: ApprovalLockedPeriod['status']): ApprovalLockedPeriod => ({
  period: PERIOD,
  statementId: 'st-oct',
  status,
});
const NOV_DRAFT: ApprovalLockedPeriod = { period: '2026-11', statementId: 'st-nov', status: 'DRAFT' };
const LOCKED: ApprovalLockedPeriod[] = [oct('REVIEWED'), NOV_DRAFT];

/** تواريخ عمل رنا: على رأس العمل، أو انتهى عقدها في سبتمبر فلا يتداخل عملها مع أكتوبر. */
const employmentOf = (departed: boolean) =>
  new Map([
    [
      RANA,
      { hireDate: '2025-01-01', contractEnd: departed ? '2026-09-30' : null, deletedOn: null },
    ],
  ]);

/** مصادر شهر أكتوبر وبصمتاها المحسوبتان، وبيها صف كشف REVIEWED مطابق لهما. */
function reviewedSource(withCarry = false): {
  source: CommissionStatementSource;
  command: CommissionStatementApproveCommand;
} {
  const base = statementSource();
  const draft: CommissionStatementSource = withCarry
    ? {
        ...base,
        month: {
          ...base.month,
          carries: [
            {
              employeeId: RANA,
              kind: 'COMMISSION',
              amount: -9000n,
              sourceStatementId: 'st-sep',
              sourcePeriod: '2026-09',
              targetPeriod: PERIOD,
            },
          ],
        },
      }
    : base;
  const computed = computeStatement(PERIOD, draft, hasher);
  const source = {
    ...draft,
    statement: statementRecord({
      status: 'REVIEWED',
      currentFingerprint: computed.inputFingerprint,
      reviewedFingerprint: computed.inputFingerprint,
      reviewedStatementFingerprint: computed.statementFingerprint,
    }),
  };
  const command: CommissionStatementApproveCommand = {
    companyId: 'c',
    userId: 'u',
    businessId: BUSINESS,
    period: PERIOD,
    expectedFingerprint: computed.inputFingerprint,
    expectedStatementFingerprint: computed.statementFingerprint,
    key: 'k',
    fingerprint: 'f',
  };
  return { source, command };
}

interface Options {
  readonly source: CommissionStatementSource;
  readonly locked?: ApprovalLockedPeriod[];
  readonly today?: string | null;
  readonly access?: 'FORBIDDEN' | 'FEATURE_DISABLED' | null;
  readonly accessAfterLock?: 'FORBIDDEN' | 'FEATURE_DISABLED' | null;
  readonly switchEnabled?: boolean;
  readonly proof?: StoredCoverageProof | null;
  readonly pending?: number;
  readonly tamperFrozen?: boolean;
  readonly departed?: boolean;
}

/** نطاق اعتماد بيسجّل كل خطوة بترتيبها، وبيرجّع المجمّد كما أُدخل إلا لو الاختبار طلب العبث به. */
function recordingScope(options: Options) {
  const calls: string[] = [];
  const carries: CarryWrite[] = [];
  let frozen: FrozenStatementRead | null = null;
  let accessCalls = 0;
  const scope: CommissionStatementApproveScope = {
    cutoff: async () => (calls.push('cutoff'), '2026-11-15 10:00:00.123456+00'),
    localToday: async () => (
      calls.push('localToday'),
      options.today === undefined ? '2026-11-15' : options.today
    ),
    recheckAccess: async () => {
      calls.push('recheckAccess');
      accessCalls += 1;
      return accessCalls === 1 ? (options.access ?? null) : (options.accessAfterLock ?? null);
    },
    lockPeriods: async (periods) => {
      calls.push(`lockPeriods:${periods.join(',')}`);
      return options.locked ?? LOCKED;
    },
    readCoverageGate: async () => {
      calls.push('readCoverageGate');
      return {
        proof: options.proof === undefined ? PROOF : options.proof,
        switchEnabled: options.switchEnabled ?? true,
        expected: RULES,
      };
    },
    readSource: async () => (calls.push('readSource'), options.source),
    readLineShares: async () => (calls.push('readLineShares'), []),
    countPendingEvents: async () => (calls.push('countPendingEvents'), options.pending ?? 0),
    readEmployment: async () => (calls.push('readEmployment'), employmentOf(options.departed === true)),
    markApproved: async () => void calls.push('markApproved'),
    freeze: async (_statementId, rows, attachments) => {
      calls.push('freeze');
      frozen = { rows, attachments };
    },
    readFrozen: async () => {
      calls.push('readFrozen');
      const stored = frozen ?? { rows: [], attachments: [] };
      return options.tamperFrozen === true
        ? { rows: stored.rows.slice(1), attachments: stored.attachments }
        : stored;
    },
    writeCarries: async (_statementId, _period, writes) => {
      calls.push('writeCarries');
      carries.push(...writes);
    },
    audit: async () => void calls.push('audit'),
    readApprovedAt: async () => '2026-11-15T10:00:00.123+00:00',
  };
  return { scope, calls, carries };
}

const run = (
  scope: CommissionStatementApproveScope,
  command: CommissionStatementApproveCommand,
) => {
  const transactions: CommissionStatementApproveTransactions = {
    run: (_command, work) => work(scope),
  };
  return new ApproveCommissionStatementUseCase(transactions, hasher).execute(command);
};

const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) =>
      error instanceof CommissionPlanVersionError ? error : Promise.reject(error),
  );

describe('approving a reviewed month (CM-34, ADR-0054 section 7)', () => {
  it('runs the steps in the mandated order and returns the frozen statement', async () => {
    const { source, command } = reviewedSource();
    const { scope, calls } = recordingScope({ source });

    const view = await run(scope, command);

    expect(calls).toEqual([
      'cutoff',
      'localToday',
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
    const { scope } = recordingScope({ source, locked, access: 'FORBIDDEN', proof: null });

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
