import {
  CommissionBlockNoticesMissingError,
  type CommissionCorrectionScope,
  type CommissionMonthProjection,
  type CommissionOpenBlock,
} from '@pospay/commissions-posting';
import { expect, it } from 'vitest';

import { CommissionPlanVersionError } from '../domain/errors.ts';
import { mapCommissionWriteError } from '../http/commission-input-errors.ts';
import type { DomainEvent } from '../../../shared/ports/outbox-writer.port.ts';
import type {
  CommissionPeriodRepairCommand,
  CommissionPeriodRepairScope,
} from '../ports/commission-period-repair-transactions.port.ts';
import { repairCommissionPeriod } from '../use-cases/repair-commission-period/repair-commission-period.usecase.ts';

type EnginePlanVersion = CommissionMonthProjection['versions'][number];

const COMMAND: CommissionPeriodRepairCommand = {
  companyId: 'company-a',
  userId: 'user-a',
  businessId: 'business-a',
  employeeId: 'employee-a',
  key: 'key',
  fingerprint: 'f'.repeat(64),
  input: {
    period: '2026-09',
    plan: {
      base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
      tiers: { enabled: false },
      package_sale: { enabled: false },
    },
  },
};

const ids = { newId: () => 'new-id' };
const october = new Date('2026-10-30T12:00:00.000Z');

const repairVersion = (): EnginePlanVersion => ({
  employeeId: 'employee-a',
  effectiveFrom: '2026-09-01',
  wholePeriod: false,
  repairPeriod: '2026-09',
  createdAt: 2n,
  version: 2n,
  base: { enabled: true, calc: { kind: 'PCT', value: 500n } },
  tiers: { enabled: false },
  packageSale: { enabled: false },
});

const projection = (versions: EnginePlanVersion[]): CommissionMonthProjection => ({
  employeeId: 'employee-a',
  period: '2026-09',
  lines: [
    {
      employeeId: 'employee-a',
      serviceId: 'service-a',
      branchId: 'branch-a',
      lineId: 'line-a',
      occurredAt: 1n,
      recordedAt: 1n,
      businessDate: '2026-09-10',
      netShare: 200_000n,
      shareBps: 10_000n,
      counts: true,
      ruleSnapshot: { kind: 'FOLLOW_PLAN' },
      status: 'ACTIVE',
    },
  ],
  sales: [],
  salaries: [],
  versions,
  overrides: [],
  tips: [],
  corrections: [],
});

/** نطاق تصحيح بسيط يسجّل كل نداء: الإسقاط والتوقف المفتوح اللي بيرجعهم الاختبار. */
function fakeCorrections(
  month: CommissionMonthProjection,
  open: CommissionOpenBlock | null,
  calls: string[],
): CommissionCorrectionScope {
  return {
    readMonthProjection: async () => month,
    readOpenBlock: async () => open,
    insertBlock: async () => {
      calls.push('insertBlock');
      return 'new-block';
    },
    updateBlockCode: async () => {
      calls.push('updateBlockCode');
    },
    resolveBlock: async () => {
      calls.push('resolveBlock');
    },
    bumpGeneration: async () => {
      calls.push('bumpGeneration');
      return 1;
    },
    readFrozenSources: async () => [],
    readPostedCorrections: async () => [],
    readAttachmentSnapshot: async () => [],
    insertCorrections: async (input) => {
      calls.push(`insertCorrections:${input.drafts.length}`);
    },
  };
}

const recordingOutbox = (
  calls: string[],
  events: DomainEvent[],
): CommissionPeriodRepairScope['outbox'] => ({
  append: async (event) => {
    calls.push('outbox');
    events.push(event);
  },
});

const fakeLock =
  (calls: string[], locks: (readonly string[])[]): CommissionPeriodRepairScope['lockPeriods'] =>
  async (periods) => {
    calls.push('lockPeriods');
    locks.push(periods);
    return periods.map((period, index) => ({
      period,
      statementId: `statement-${index}`,
      status: period === '2026-10' ? ('DRAFT' as const) : ('APPROVED' as const),
    }));
  };

interface Setup {
  readonly scope: CommissionPeriodRepairScope;
  readonly calls: string[];
  readonly locks: (readonly string[])[];
  readonly events: DomainEvent[];
}

function setup(options: {
  readonly month?: CommissionMonthProjection;
  readonly block?: { id: string; code: 'NO_PLAN' | 'NO_SALARY'; firstEventId: string } | null;
  readonly stepOpen?: CommissionOpenBlock | null;
  readonly access?: 'FORBIDDEN' | 'FEATURE_DISABLED' | null;
  readonly after?: 'NO_SALARY';
}): Setup {
  const calls: string[] = [];
  const locks: (readonly string[])[] = [];
  const events: DomainEvent[] = [];
  const block =
    options.block === undefined
      ? { id: 'block-a', code: 'NO_PLAN' as const, firstEventId: 'event-a' }
      : options.block;
  const scope: CommissionPeriodRepairScope = {
    lockEmployee: async () => {
      calls.push('lockEmployee');
      return true;
    },
    calendar: async () => ({ timeZone: 'Asia/Kuwait', createdAt: new Date('2026-01-01') }),
    lockPeriods: fakeLock(calls, locks),
    reopenReviewed: async () => undefined,
    recheckAccess: async () => {
      calls.push('recheckAccess');
      return options.access ?? null;
    },
    latestVersion: async () => 1,
    readOpenBlock: async () => {
      calls.push('readOpenBlock');
      return block;
    },
    insert: async (record) => {
      calls.push('insert');
      return record;
    },
    corrections: () => {
      calls.push('corrections');
      return fakeCorrections(
        options.month ?? projection([repairVersion()]),
        options.stepOpen === undefined ? { id: 'block-a', code: 'NO_PLAN' } : options.stepOpen,
        calls,
      );
    },
    readBlock: async (id) => ({
      id,
      code: options.after ?? 'NO_PLAN',
      resolved: options.after === undefined,
    }),
    audit: async () => {
      calls.push('audit');
    },
    outbox: recordingOutbox(calls, events),
  };
  return { scope, calls, locks, events };
}

const run = (s: Setup, now: () => Date = () => october) =>
  repairCommissionPeriod(s.scope, COMMAND, ids, { now });

it('locks the employee, then one ascending call from the source month to the current month, then checks access and the block before any write', async () => {
  const s = setup({});

  const result = await run(s);

  expect(s.locks).toEqual([['2026-09', '2026-10']]);
  expect(s.calls.filter((call) => !call.includes(':'))).toEqual([
    'lockEmployee',
    'lockPeriods',
    'recheckAccess',
    'readOpenBlock',
    'insert',
    'corrections',
    'bumpGeneration',
    'resolveBlock',
    'audit',
    'outbox',
  ]);
  expect(s.calls).toContain('insertCorrections:1');
  const stored = result.version;
  expect([
    stored.repair_period,
    stored.effective_from,
    stored.whole_period,
    stored.version,
  ]).toEqual(['2026-09', '2026-09-01', false, 2]);
});

it.each([
  { label: 'no block', block: null },
  { label: 'a NO_SALARY block', block: { id: 'b', code: 'NO_SALARY' as const, firstEventId: 'e' } },
])('is COMMISSION_REPAIR_NOT_ALLOWED with $label and stores nothing', async ({ block }) => {
  const s = setup({ block });

  await expect(run(s)).rejects.toMatchObject({ code: 'COMMISSION_REPAIR_NOT_ALLOWED' });

  expect(s.calls).not.toContain('insert');
  expect(s.calls).not.toContain('corrections');
});

it.each(['0001-01', '2025-12', '2026-10', '2027-03'])(
  'refuses the month %s before any lock: it is before the business or not yet closed',
  async (period) => {
    const s = setup({});

    await expect(
      repairCommissionPeriod(s.scope, { ...COMMAND, input: { ...COMMAND.input, period } }, ids, {
        now: () => october,
      }),
    ).rejects.toMatchObject({ code: 'COMMISSION_REPAIR_NOT_ALLOWED' });

    expect(s.locks).toEqual([]);
  },
);

it('refuses a change of month after the lock as TRANSACTION_RETRY_REQUIRED, with one lock call and no write', async () => {
  const s = setup({});
  let reads = 0;

  await expect(
    run(s, () => new Date(++reads === 1 ? '2026-10-30T12:00:00.000Z' : '2026-11-02T12:00:00.000Z')),
  ).rejects.toMatchObject({ code: 'TRANSACTION_RETRY_REQUIRED' });

  expect(s.locks).toHaveLength(1);
  expect(s.calls).not.toContain('readOpenBlock');
  expect(s.calls).not.toContain('insert');
});

it('checks access after the locks and before it reads the block', async () => {
  const s = setup({ access: 'FORBIDDEN' });

  await expect(run(s)).rejects.toMatchObject({ code: 'FORBIDDEN' });

  expect(s.calls).toEqual(['lockEmployee', 'lockPeriods', 'recheckAccess']);
});

it('validates the plan first: an invalid plan touches no lock', async () => {
  const s = setup({});
  const invalid = {
    ...COMMAND,
    input: {
      ...COMMAND.input,
      plan: {
        ...COMMAND.input.plan,
        tiers: {
          enabled: true as const,
          mode: 'MARGINAL' as const,
          accumulator: 'AMOUNT' as const,
          steps: [],
        },
      },
    },
  };

  await expect(
    repairCommissionPeriod(s.scope, invalid, ids, { now: () => october }),
  ).rejects.toBeInstanceOf(CommissionPlanVersionError);

  expect(s.calls).toEqual([]);
});

it('never reaches the RECORD branch: a month that still cannot be priced keeps the open block and records no new one', async () => {
  const s = setup({ month: projection([]), stepOpen: { id: 'block-a', code: 'NO_PLAN' } });

  await run(s);

  expect(s.calls).not.toContain('insertBlock');
  expect(s.calls).not.toContain('resolveBlock');
});

it('lets CommissionBlockNoticesMissingError leave unmapped, so the route answers a 500 and the transaction rolls back', async () => {
  // حالة مستحيلة بعد فحص التصحيح المفتوح: الخطوة ما لقيتش صفاً مفتوحاً فهتسجّل توقفاً جديداً من غير منفذ جرس.
  const s = setup({ month: projection([]), stepOpen: null });

  const failure = await run(s).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(CommissionBlockNoticesMissingError);
  expect(s.calls).not.toContain('insertBlock');
  expect(s.calls).not.toContain('audit');
  expect(() => mapCommissionWriteError(failure)).toThrow(failure as Error);
  let mapped: unknown;
  try {
    mapCommissionWriteError(failure);
  } catch (error) {
    mapped = error;
  }
  expect(mapped).toBe(failure);
});

it('appends one CommissionPeriodRepairSaved with ids and the outcome only, on the new version as its aggregate', async () => {
  const s = setup({});

  await run(s);

  expect(s.events).toEqual([
    {
      aggregateType: 'commission_plan_version',
      aggregateId: 'new-id',
      eventType: 'CommissionPeriodRepairSaved',
      payload: {
        business_id: 'business-a',
        employee_id: 'employee-a',
        period: '2026-09',
        version_id: 'new-id',
        blocked_correction_id: 'block-a',
        resolved: true,
      },
    },
  ]);
});

it('still appends the event when the block flips to NO_SALARY (CM-52b): the repair was saved, not the block closed', async () => {
  const s = setup({ after: 'NO_SALARY' });

  await run(s);

  expect(s.events.map((event) => event.payload)).toEqual([
    expect.objectContaining({ resolved: false }),
  ]);
});

it('appends no event when the repair is refused', async () => {
  const s = setup({ block: null });

  await run(s).catch(() => undefined);

  expect(s.events).toEqual([]);
});

it('answers 409 COMMISSION_PERIOD_CLOSED when the step finds no DRAFT month to post into, before the audit and the event', async () => {
  const s = setup({});
  const closed = {
    ...s.scope,
    lockPeriods: async (periods: readonly string[]) =>
      periods.map((period, index) => ({
        period,
        statementId: `statement-${index}`,
        status: 'APPROVED' as const,
      })),
  };

  await expect(
    repairCommissionPeriod(closed, COMMAND, ids, { now: () => october }),
  ).rejects.toMatchObject({ code: 'COMMISSION_PERIOD_CLOSED' });

  expect(s.calls).not.toContain('audit');
  expect(s.events).toEqual([]);
});
