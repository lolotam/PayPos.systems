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

export const hasher = new CanonicalSha256FingerprintHasher();
export const TYPES = ['SalaryChanged', 'SessionTipsChanged'];
export const RULES = {
  version: 1,
  countedTypes: TYPES,
  consumerId: 'commissions.project-inputs',
  databaseName: 'pospay_staging',
  systemId: '7301234567890123456',
};
export const PROOF: StoredCoverageProof = {
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
export const oct = (status: ApprovalLockedPeriod['status']): ApprovalLockedPeriod => ({
  period: PERIOD,
  statementId: 'st-oct',
  status,
});
export const NOV_DRAFT: ApprovalLockedPeriod = { period: '2026-11', statementId: 'st-nov', status: 'DRAFT' };
export const LOCKED: ApprovalLockedPeriod[] = [oct('REVIEWED'), NOV_DRAFT];

/** تواريخ عمل رنا: على رأس العمل، أو انتهى عقدها في سبتمبر فلا يتداخل عملها مع أكتوبر. */
export const employmentOf = (departed: boolean) =>
  new Map([
    [
      RANA,
      { hireDate: '2025-01-01', contractEnd: departed ? '2026-09-30' : null, deletedOn: null },
    ],
  ]);

/** مصادر شهر أكتوبر وبصمتاها المحسوبتان، وبيها صف كشف REVIEWED مطابق لهما. */
export function reviewedSource(withCarry = false): {
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

export interface Options {
  readonly source: CommissionStatementSource;
  readonly locked?: ApprovalLockedPeriod[];
  readonly today?: string | null;
  /** حالة الكشف في القراءة المبكرة قبل القفل؛ الافتراضي REVIEWED. */
  readonly preStatus?: 'DRAFT' | 'REVIEWED' | 'APPROVED' | 'PAID' | null;
  readonly access?: 'FORBIDDEN' | 'FEATURE_DISABLED' | null;
  readonly accessAfterLock?: 'FORBIDDEN' | 'FEATURE_DISABLED' | null;
  readonly switchEnabled?: boolean;
  readonly proof?: StoredCoverageProof | null;
  readonly pending?: number;
  readonly tamperFrozen?: boolean;
  readonly departed?: boolean;
}

/** نطاق اعتماد بيسجّل كل خطوة بترتيبها، وبيرجّع المجمّد كما أُدخل إلا لو الاختبار طلب العبث به. */
export function recordingScope(options: Options) {
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
    readStatementStatus: async () => (
      calls.push('readStatementStatus'),
      options.preStatus === undefined ? 'REVIEWED' : options.preStatus
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

/**
 * يحاكي ترتيب الإنتاج: فحص الصلاحية يسبق المطالبة بمفتاح إعادة الإرسال ثم يعمل المعالج، فنداء الصلاحية الأول في
 * المحاكاة هو الذي قبل الانتظار، والثاني هو إعادة الفحص بعد قفل الشهور التي تسبق أي رد.
 */
export const run = (
  scope: CommissionStatementApproveScope,
  command: CommissionStatementApproveCommand,
) => {
  const transactions: CommissionStatementApproveTransactions = {
    run: async (_command, work) => {
      const failure = await scope.recheckAccess();
      if (failure !== null) throw new CommissionPlanVersionError(failure);
      return work(scope);
    },
  };
  return new ApproveCommissionStatementUseCase(transactions, hasher).execute(command);
};

export const refusal = async (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) =>
      error instanceof CommissionPlanVersionError ? error : Promise.reject(error),
  );

