import { describe, expect, it } from 'vitest';

import type {
  CommissionReminderSchedule,
  ReminderRecoveryReaders,
  ReminderRecoveryStore,
} from '../../../ports/reminder-recovery.port.ts';
import { checkCommissionReminderReadiness } from '../check-commission-reminder-readiness.ts';

const RUN_ID = 'a'.repeat(40);
const CUTOFF = '2026-11-25T09:00:00.000Z';
const COMPANY = 'company-1';
const COMPANY_KEY = `key:${COMPANY}`;

/** حالة الفحص: الشهادة، الأعلام، الشركات الموقوفة، ومفاتيح المجدولات الموجودة. */
interface State {
  readonly sentinel: {
    readonly release: string;
    readonly runId: string;
    readonly passId: string;
    readonly cutoff: string;
    readonly cutoffSeq: string;
  } | null;
  readonly lease: {
    readonly incidentId: string | null;
    readonly runId: string;
    readonly passId: string;
  } | null;
  readonly runId: string;
  readonly flags: readonly {
    readonly id: string;
    readonly code: string;
    readonly raisedAt: Date;
  }[];
  readonly parked: readonly string[];
  readonly overflow: boolean;
  readonly dbNow: Date;
  /** مفاتيح الجدولات الموجودة في Redis. */
  readonly schedulers: readonly string[];
}

/** متجر في الذاكرة: اللقطتان بتتغيران بالترتيب المطلوب في كل حالة. */
function fakeStore(current: State): ReminderRecoveryStore {
  return {
    acquire: async () => true,
    renew: async () => true,
    release: async () => true,
    setIncident: async () => true,
    snapshot: async () => ({
      sentinel: current.sentinel,
      lease: current.lease,
      serverRunId: current.runId,
    }),
    probe: async (schedulerKeys) => ({
      sentinel: current.sentinel,
      lease: current.lease,
      serverRunId: current.runId,
      schedulers: schedulerKeys.map((key) => current.schedulers.includes(key)),
    }),
    readSlot: async () => null,
    writeSlot: async () => true,
    invalidateSentinel: async () => true,
    publish: async () => true,
    serverRunId: async () => current.runId,
  };
}

/** قارئ المرسّل في الذاكرة: القراء بتتغير بين النداء الأول والتاني. */
function fakeReaders(current: State): ReminderRecoveryReaders {
  return {
    sampleReminderRecoveryCutoff: async () => ({
      cutoff: new Date(CUTOFF),
      maxOutboxSeq: '42',
    }),
    companyIdPage: async () => [],
    raiseRecoveryFlag: async () => ({ raised: false, raisedAt: null }),
    openRecoveryFlags: async () => current.flags,
    parkedCompanyCreatedAfter: async () => ({
      companyIds: current.parked,
      overflow: current.overflow,
      dbNow: current.dbNow,
    }),
  };
}

/** جدولة في الذاكرة: مفاتيح المجدولات الموجودة. */
function fakeSchedule(): CommissionReminderSchedule {
  return {
    register: async () => ({ registered: true }),
    exists: async () => true,
    existsAll: async () => [],
    schedulerKeys: (companyIds) => companyIds.map((id) => `key:${id}`),
  };
}

function state(patch: Partial<State> = {}): State {
  return {
    sentinel: {
      release: 'worker',
      runId: RUN_ID,
      passId: 'pass-1',
      cutoff: CUTOFF,
      cutoffSeq: '42',
    },
    lease: null,
    runId: RUN_ID,
    flags: [],
    parked: [],
    overflow: false,
    dbNow: new Date('2026-11-25T10:00:00Z'),
    schedulers: [],
    ...patch,
  };
}

function check(current: State) {
  return checkCommissionReminderReadiness({
    database: fakeReaders(current),
    store: fakeStore(current),
    schedule: fakeSchedule(),
  });
}

describe('checkCommissionReminderReadiness — certificate and incidents', () => {
  it('is healthy with a valid certificate, no incident and no parked company', async () => {
    expect(await check(state())).toEqual({ ready: true, reason: null });
  });

  it('is degraded without a certificate', async () => {
    expect(await check(state({ sentinel: null }))).toEqual({
      ready: false,
      reason: 'SENTINEL_MISSING',
    });
  });

  it('is degraded when the certificate belongs to another Redis run', async () => {
    expect(await check(state({ runId: 'b'.repeat(40) }))).toEqual({
      ready: false,
      reason: 'SENTINEL_RUN_ID_CHANGED',
    });
  });

  it('is degraded while a recovery pass owns the key', async () => {
    const lease = { incidentId: null, runId: RUN_ID, passId: 'pass-2' };
    expect(await check(state({ lease }))).toEqual({
      ready: false,
      reason: 'RECOVERY_IN_PROGRESS',
    });
  });
});

describe('checkCommissionReminderReadiness — parked companies', () => {
  it('is degraded for an open incident of any code (Item 9)', async () => {
    expect(
      await check(
        state({ flags: [{ id: 'flag-1', code: 'SOME_OTHER_CODE', raisedAt: new Date() }] }),
      ),
    ).toEqual({ ready: false, reason: 'OPEN_INCIDENT' });
  });

  it('is degraded on a parked-read overflow', async () => {
    expect(await check(state({ overflow: true }))).toEqual({
      ready: false,
      reason: 'PARKED_OVERFLOW',
    });
  });

  it('is degraded when the database clock moved backward (Item 2)', async () => {
    expect(await check(state({ dbNow: new Date('2026-11-25T08:00:00Z') }))).toEqual({
      ready: false,
      reason: 'CLOCK_REGRESSION',
    });
  });

  it('is degraded when a parked company lost its schedule (Item 3)', async () => {
    const result = await check(state({ parked: [COMPANY] }));
    expect(result).toEqual({ ready: false, reason: 'SCHEDULER_MISSING' });
  });

  it('is healthy when every parked company still has its schedule', async () => {
    const result = await check(state({ parked: [COMPANY], schedulers: [COMPANY_KEY] }));
    expect(result).toEqual({ ready: true, reason: null });
  });
});

describe('checkCommissionReminderReadiness — bracketed reads (Item 3)', () => {
  it('is degraded when the certificate changed between the two snapshots (Item 3)', async () => {
    const current = state();
    const store = fakeStore(current);
    const changing: ReminderRecoveryStore = {
      ...store,
      probe: async (schedulerKeys) => {
        const probe = await store.probe(schedulerKeys);
        return {
          ...probe,
          sentinel: probe.sentinel === null ? null : { ...probe.sentinel, passId: 'other' },
        };
      },
    };
    const result = await checkCommissionReminderReadiness({
      database: fakeReaders(current),
      store: changing,
      schedule: fakeSchedule(),
    });
    expect(result).toEqual({ ready: false, reason: 'CERTIFICATE_CHANGED' });
  });

  it('is degraded when a flag opens between the two database reads (Item 3)', async () => {
    const current = state();
    let calls = 0;
    const readers = fakeReaders(current);
    const changing: ReminderRecoveryReaders = {
      ...readers,
      openRecoveryFlags: async () => {
        calls += 1;
        return calls > 1 ? [{ id: 'flag-1', code: 'X', raisedAt: new Date() }] : [];
      },
    };
    const result = await checkCommissionReminderReadiness({
      database: changing,
      store: fakeStore(current),
      schedule: fakeSchedule(),
    });
    expect(result).toEqual({ ready: false, reason: 'FLAG_APPEARED' });
  });
});

describe('checkCommissionReminderReadiness — final clock fence', () => {
  it('is degraded when clock regression appears on the final database read', async () => {
    const current = state();
    let calls = 0;
    const readers = fakeReaders(current);
    const changing: ReminderRecoveryReaders = {
      ...readers,
      parkedCompanyCreatedAfter: async () => {
        calls += 1;
        return {
          companyIds: [],
          overflow: false,
          dbNow: calls > 1 ? new Date('2026-11-25T08:00:00Z') : current.dbNow,
        };
      },
    };
    const result = await checkCommissionReminderReadiness({
      database: changing,
      store: fakeStore(current),
      schedule: fakeSchedule(),
    });
    expect(result).toEqual({ ready: false, reason: 'CLOCK_REGRESSION' });
  });
});

describe('checkCommissionReminderReadiness — parked set fence (Item 3)', () => {
  it('is degraded when the parked set changes between the two database reads (Item 3)', async () => {
    const current = state();
    let calls = 0;
    const readers = fakeReaders(current);
    const changing: ReminderRecoveryReaders = {
      ...readers,
      parkedCompanyCreatedAfter: async () => {
        calls += 1;
        return {
          companyIds: calls > 1 ? [COMPANY] : [],
          overflow: false,
          dbNow: new Date('2026-11-25T10:00:00Z'),
        };
      },
    };
    const result = await checkCommissionReminderReadiness({
      database: changing,
      store: fakeStore(current),
      schedule: fakeSchedule(),
    });
    expect(result).toEqual({ ready: false, reason: 'PARKED_SET_CHANGED' });
  });
});
