import type {
  CommissionAttachmentInterval,
  CommissionCorrectionDraft,
  CommissionFrozenSource,
  CommissionPostedCorrection,
  CommissionOpenBlock,
  CommissionBlockCodeUpdateInput,
  CommissionBlockInsertInput,
  CommissionBlockResolutionInput,
  CommissionMonthProjection,
  CommissionCorrectionInsertInput,
  CommissionCorrectionScope,
} from '@pospay/commissions-posting';
import type {
  CommissionPeriodEmployee,
  LockedCommissionPeriod,
} from '../domain/commission-line-types.ts';
import type {
  CommissionSalaryProjectionRow,
  CommissionTipProjectionSession,
} from '../domain/commission-tip-salary-inputs.ts';
import type {
  CommissionPeriodLockInput,
  CommissionPeriodReopenInput,
} from '../ports/commission-line-projection.port.ts';
import type {
  CommissionSalaryProjectionScope,
  CommissionSalaryProjectionWrite,
  HeldCommissionTipProjectionSession,
  CommissionTipProjectionScope,
} from '../ports/commission-tip-salary-projection.port.ts';

export const employeeA = 'employee-a';
export const clockNow = '2026-12-05T09:00:00Z';

export const tipInput = () => ({
  companyId: 'company-a',
  eventId: 'event-a',
  businessId: 'business-a',
  branchId: 'branch-a',
  sessionId: 'session-a',
  businessDate: '2026-10-01',
  revision: 2,
  tips: [{ employeeId: employeeA, method: 'CARD' as const, amount: '8.000' }],
});

export const salaryInput = () => ({
  companyId: 'company-a',
  eventId: 'event-a',
  businessId: 'business-a',
  employeeId: employeeA,
  effectiveFrom: '2026-10-01',
  amount: '550.000',
  revision: 2,
});

export const heldSession = (): HeldCommissionTipProjectionSession => ({
  businessId: 'business-a',
  sessionId: 'session-a',
  branchId: 'branch-a',
  businessDate: '2026-10-01',
  revision: 1,
  period: '2026-10',
  rows: [{ employeeId: employeeA, method: 'CARD', amount: 5_000n }],
});

export const heldSalary = (): CommissionSalaryProjectionRow => ({
  businessId: 'business-a',
  employeeId: employeeA,
  effectiveFrom: '2026-10-01',
  amount: 500_000n,
  revision: 1,
});

export class FakeTipScope implements CommissionTipProjectionScope {
  readonly calls: string[] = [];
  readonly lockInputs: CommissionPeriodLockInput[] = [];
  locked: readonly LockedCommissionPeriod[] = [];
  replaced: CommissionTipProjectionSession | null = null;
  reopenInput: CommissionPeriodReopenInput | undefined;

  async lockSession(): Promise<void> {
    this.calls.push('lockSession');
  }
  async readTipSession(): Promise<HeldCommissionTipProjectionSession | null> {
    this.calls.push('readTipSession');
    return heldSession();
  }
  async businessTimeZone(): Promise<string | null> {
    this.calls.push('businessTimeZone');
    return 'Asia/Kuwait';
  }
  async lockPeriods(input: CommissionPeriodLockInput): Promise<readonly LockedCommissionPeriod[]> {
    this.calls.push('lockPeriods');
    this.lockInputs.push(input);
    return this.locked;
  }
  async replaceTipSession(session: CommissionTipProjectionSession): Promise<void> {
    this.calls.push('replaceTipSession');
    this.replaced = session;
  }
  async reopenReviewed(input: CommissionPeriodReopenInput): Promise<void> {
    this.calls.push('reopenReviewed');
    this.reopenInput = input;
  }
}

export class FakeSalaryScope implements CommissionSalaryProjectionScope {
  readonly calls: string[] = [];
  readonly lockInputs: CommissionPeriodLockInput[] = [];
  locked: readonly LockedCommissionPeriod[] = [];
  upserted: CommissionSalaryProjectionWrite | null = null;
  reopenInput: CommissionPeriodReopenInput | undefined;

  async lockEmployee(): Promise<void> {
    this.calls.push('lockEmployee');
  }
  async lockSalaryIdentity(): Promise<void> {
    this.calls.push('lockSalaryIdentity');
  }
  async employeeBusiness(): Promise<string | null> {
    this.calls.push('employeeBusiness');
    return 'business-a';
  }
  async readSalary(): Promise<CommissionSalaryProjectionRow | null> {
    this.calls.push('readSalary');
    return heldSalary();
  }
  async readNextEffectiveFrom(): Promise<string | null> {
    this.calls.push('readNextEffectiveFrom');
    return null;
  }
  async businessCalendar(): Promise<{ timeZone: string; createdAt: Date } | null> {
    this.calls.push('businessCalendar');
    return { timeZone: 'Asia/Kuwait', createdAt: new Date('2026-01-01T00:00:00Z') };
  }
  async lockPeriods(input: CommissionPeriodLockInput): Promise<readonly LockedCommissionPeriod[]> {
    this.calls.push('lockPeriods');
    this.lockInputs.push(input);
    return this.locked;
  }
  async upsertSalary(row: CommissionSalaryProjectionWrite): Promise<void> {
    this.calls.push('upsertSalary');
    this.upserted = row;
  }
  async reopenReviewed(input: CommissionPeriodReopenInput): Promise<void> {
    this.calls.push('reopenReviewed');
    this.reopenInput = input;
  }
}

export const plan = (): CommissionMonthProjection['versions'][number] => ({
  employeeId: employeeA,
  effectiveFrom: '2026-10-01',
  wholePeriod: false,
  repairPeriod: null,
  createdAt: 1n,
  version: 1n,
  base: { enabled: true, calc: { kind: 'PCT', value: 1000n } },
  tiers: { enabled: false },
  packageSale: { enabled: false },
});

export const monthProjection = (
  patch: Partial<CommissionMonthProjection> = {},
): CommissionMonthProjection => ({
  employeeId: employeeA,
  period: '2026-10',
  lines: [],
  sales: [],
  salaries: [],
  versions: [plan()],
  overrides: [],
  tips: [],
  corrections: [],
  ...patch,
});

export class FakeCorrections implements CommissionCorrectionScope {
  projection = monthProjection();
  frozen: readonly CommissionFrozenSource[] = [];
  posted: readonly CommissionPostedCorrection[] = [];
  attachments: readonly CommissionAttachmentInterval[] = [];
  readonly drafts: CommissionCorrectionDraft[] = [];
  readonly bumpPeriods: CommissionPeriodEmployee[] = [];
  openBlock: CommissionOpenBlock | null = null;
  readonly insertedBlocks: CommissionBlockInsertInput[] = [];
  readonly codeUpdates: CommissionBlockCodeUpdateInput[] = [];
  readonly resolutions: CommissionBlockResolutionInput[] = [];

  constructor(private readonly calls: string[]) {}

  async bumpGeneration(input: { employeeId: string; period: string }): Promise<number> {
    this.calls.push('bumpGeneration');
    this.bumpPeriods.push({ period: input.period, employeeId: input.employeeId });
    return 1;
  }
  async readMonthProjection(): Promise<CommissionMonthProjection> {
    this.calls.push('readMonthProjection');
    return this.projection;
  }
  async readFrozenSources(): Promise<readonly CommissionFrozenSource[]> {
    this.calls.push('readFrozenSources');
    return this.frozen;
  }
  async readPostedCorrections(): Promise<readonly CommissionPostedCorrection[]> {
    this.calls.push('readPostedCorrections');
    return this.posted;
  }
  async readAttachmentSnapshot(): Promise<readonly CommissionAttachmentInterval[]> {
    this.calls.push('readAttachmentSnapshot');
    return this.attachments;
  }
  async insertCorrections(input: CommissionCorrectionInsertInput): Promise<void> {
    this.calls.push('insertCorrections');
    this.drafts.push(...input.drafts);
  }
  async readOpenBlock(): Promise<CommissionOpenBlock | null> {
    this.calls.push('readOpenBlock');
    return this.openBlock;
  }
  async insertBlock(input: CommissionBlockInsertInput): Promise<string> {
    this.calls.push('insertBlock');
    this.insertedBlocks.push(input);
    return 'block-1';
  }
  async updateBlockCode(input: CommissionBlockCodeUpdateInput): Promise<void> {
    this.calls.push('updateBlockCode');
    this.codeUpdates.push(input);
  }
  async resolveBlock(input: CommissionBlockResolutionInput): Promise<void> {
    this.calls.push('resolveBlock');
    this.resolutions.push(input);
  }
}

export const closedOctNovDec = (): LockedCommissionPeriod[] => [
  { period: '2026-10', statementId: 'statement-oct', status: 'APPROVED' },
  { period: '2026-11', statementId: 'statement-nov', status: 'APPROVED' },
  { period: '2026-12', statementId: 'statement-dec', status: 'DRAFT' },
];

export const frozenTip = (method: 'CARD' | 'CASH', amount: bigint): CommissionFrozenSource => ({
  sourceRef: `tip:session-a:${method}`,
  kind: method === 'CARD' ? 'TIP_CARD' : 'TIP_CASH',
  amount,
  attribution: {
    sourceBranchId: 'branch-a',
    sourceBusinessDate: '2026-10-01',
    attachedBranchIds: ['branch-a'],
  },
});

export const projectedTip = (
  method: 'CARD' | 'CASH',
  amount: bigint,
): CommissionMonthProjection['tips'][number] => ({
  sessionId: 'session-a',
  employeeId: employeeA,
  branchId: 'branch-a',
  businessDate: '2026-10-01',
  method,
  amount,
});

/** إسقاط المثال المحسوب لشهر الراتب: بنودا L1 وL2 بخطة مضاعف الراتب والراتب الجديد. */
export const salaryWorkedProjection = (
  patch: Partial<CommissionMonthProjection> = {},
): CommissionMonthProjection =>
  monthProjection({
    lines: [
      {
        employeeId: employeeA,
        serviceId: 'service-a',
        branchId: 'branch-a',
        lineId: 'line-l1',
        occurredAt: 1n,
        recordedAt: 1n,
        businessDate: '2026-10-10',
        netShare: 400_000n,
        shareBps: 10_000n,
        counts: true,
        ruleSnapshot: { kind: 'FOLLOW_PLAN' },
        status: 'ACTIVE',
      },
      {
        employeeId: employeeA,
        serviceId: 'service-a',
        branchId: 'branch-a',
        lineId: 'line-l2',
        occurredAt: 2n,
        recordedAt: 2n,
        businessDate: '2026-10-20',
        netShare: 300_000n,
        shareBps: 10_000n,
        counts: true,
        ruleSnapshot: { kind: 'FOLLOW_PLAN' },
        status: 'ACTIVE',
      },
    ],
    salaries: [{ employeeId: employeeA, effectiveFrom: '2026-10-01', amount: 550_000n }],
    versions: [
      {
        employeeId: employeeA,
        effectiveFrom: '2025-06-01',
        wholePeriod: false,
        repairPeriod: null,
        createdAt: 1n,
        version: 1n,
        base: { enabled: false },
        tiers: {
          enabled: true,
          accumulator: 'AMOUNT',
          mode: 'MARGINAL',
          steps: [
            { from: { kind: 'SALARY_MULTIPLE', value: 100n }, calc: { kind: 'PCT', value: 1000n } },
          ],
        },
        packageSale: { enabled: false },
      },
    ],
    ...patch,
  });
