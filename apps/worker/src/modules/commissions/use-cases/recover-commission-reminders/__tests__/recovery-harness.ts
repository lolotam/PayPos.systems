import type { ReminderSlot } from '../../../domain/reminder-recovery.ts';
import type {
  CommissionReminderSchedule,
  ReminderRecoveryReaders,
  ReminderRecoveryStore,
} from '../../../ports/reminder-recovery.port.ts';
import type { RecoverCommissionRemindersDeps } from '../recover-commission-reminders.ts';

export const RUN_ID = 'a'.repeat(40);
export const COMPANY = 'company-1';

/** سجل الشهادة المخزّن في الذاكرة. */
interface SentinelRecord {
  release: string;
  runId: string;
  passId: string;
  cutoff: string;
  cutoffSeq: string;
}

/** متجر Redis في الذاكرة: نفس الضمانات (CAS على pass_id) بلا Redis حقيقي. */
export class FakeStore implements ReminderRecoveryStore {
  lease: { incidentId: string | null; runId: string; passId: string } | null = null;
  sentinel: SentinelRecord | null = null;
  slot: ReminderSlot | null = null;
  runId = RUN_ID;
  published = 0;
  invalidated = 0;
  acquireCalls = 0;
  renewResult = true;
  /** ترتيب الكتابات المشتركة: الإبطال والمسح والنشر. */
  calls: string[] = [];

  async acquire(input: {
    passId: string;
    runId: string;
    incidentId: string | null;
  }): Promise<boolean> {
    this.acquireCalls += 1;
    if (this.lease !== null) return false;
    this.lease = { incidentId: input.incidentId, runId: input.runId, passId: input.passId };
    return true;
  }

  async renew(passId: string): Promise<boolean> {
    return this.renewResult && this.lease?.passId === passId;
  }

  async release(passId: string): Promise<boolean> {
    if (this.lease?.passId !== passId) return false;
    this.lease = null;
    return true;
  }

  async setIncident(passId: string, incidentId: string): Promise<boolean> {
    if (this.lease?.passId !== passId) return false;
    this.lease = { ...this.lease, incidentId };
    return true;
  }

  async snapshot() {
    return { sentinel: this.sentinel, lease: this.lease, serverRunId: this.runId };
  }

  async probe(schedulerKeys: readonly string[]) {
    return {
      ...(await this.snapshot()),
      schedulers: schedulerKeys.map(() => true),
    };
  }

  async readSlot(): Promise<ReminderSlot | null> {
    return this.slot;
  }

  async writeSlot(input: { passId: string; slot: ReminderSlot }): Promise<boolean> {
    if (this.lease?.passId !== input.passId) return false;
    this.slot = input.slot;
    return true;
  }

  async invalidateSentinel(passId: string): Promise<boolean> {
    if (this.lease?.passId !== passId) return false;
    this.invalidated += 1;
    this.calls.push('invalidate');
    this.sentinel = null;
    return true;
  }

  async publish(input: {
    passId: string;
    incidentId: string | null;
    runId: string;
    release: string;
    cutoff: string;
    cutoffSeq: string;
  }): Promise<boolean> {
    if (this.lease?.passId !== input.passId) return false;
    if ((this.lease.incidentId ?? null) !== input.incidentId) return false;
    if (this.runId !== input.runId) return false;
    this.sentinel = {
      release: input.release,
      runId: input.runId,
      passId: input.passId,
      cutoff: input.cutoff,
      cutoffSeq: input.cutoffSeq,
    };
    this.lease = null;
    this.slot = null;
    this.published += 1;
    this.calls.push('publish');
    return true;
  }

  async serverRunId(): Promise<string | null> {
    return this.runId;
  }
}

/** حالة الفحص: الأعلام والشركات الموقوفة والقائمة. */
export interface ReadersState {
  readonly flags: { id: string; code: string; raisedAt: Date }[];
  readonly parkedCompanyIds: readonly string[];
  readonly overflow: boolean;
  readonly dbNow: Date;
  readonly companies: readonly string[];
  readonly cutoff: Date;
  readonly cutoffSeq: string;
}

/** قارئ المرسّل في الذاكرة. */
export function readersOf(state: ReadersState): ReminderRecoveryReaders {
  return {
    sampleReminderRecoveryCutoff: async () => ({
      cutoff: state.cutoff,
      maxOutboxSeq: state.cutoffSeq,
    }),
    companyIdPage: async (afterId) =>
      afterId === null ? state.companies : state.companies.filter((id) => id > afterId),
    raiseRecoveryFlag: async (id, code) => {
      if (state.flags.some((flag) => flag.code === code)) return { raised: false, raisedAt: null };
      const raisedAt = new Date(state.dbNow);
      state.flags.push({ id, code, raisedAt });
      return { raised: true, raisedAt };
    },
    openRecoveryFlags: async () => state.flags,
    parkedCompanyCreatedAfter: async () => ({
      companyIds: state.parkedCompanyIds,
      overflow: state.overflow,
      dbNow: state.dbNow,
    }),
  };
}

/** جدولة في الذاكرة: إما الجدولة موجودة أو مش موجودة. */
export class FakeSchedule implements CommissionReminderSchedule {
  readonly registered: string[] = [];
  missing = new Set<string>();
  /** تعليق عملية لحد ما تتجاوز مهلتها. */
  hang: 'register' | 'exists' | null = null;

  async register(companyId: string) {
    if (this.hang === 'register') await new Promise<never>(() => undefined);
    this.registered.push(companyId);
    this.missing.delete(companyId);
    return { registered: true };
  }

  async exists(companyId: string) {
    return !this.missing.has(companyId);
  }

  async existsAll(companyIds: readonly string[]) {
    if (this.hang === 'exists') await new Promise<never>(() => undefined);
    return companyIds.map((companyId) => !this.missing.has(companyId));
  }

  schedulerKeys(companyIds: readonly string[]) {
    return companyIds.map((companyId) => `key:${companyId}`);
  }
}

/** ساعة تقدّم بالخطوة كل ما يتقرا وقت. */
export class FakeClock {
  constructor(private current: Date) {}
  now = (): Date => this.current;
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

/** سجل يجمع التنبيهات. */
export function fakeLogger(alerts: unknown[] = []): {
  warn: (fields: unknown, message: string) => void;
} {
  return { warn: (fields) => void alerts.push(fields) };
}

export interface Harness {
  readonly store: FakeStore;
  readonly schedule: FakeSchedule;
  readonly clock: FakeClock;
  readonly state: ReadersState;
  readonly cleared: string[];
  readonly alerts: unknown[];
  readonly deps: RecoverCommissionRemindersDeps;
}

export function harness(patch: Partial<ReadersState> = {}): Harness {
  const store = new FakeStore();
  const schedule = new FakeSchedule();
  const clock = new FakeClock(new Date('2026-11-25T10:00:00Z'));
  const state: ReadersState = {
    flags: [],
    parkedCompanyIds: [],
    overflow: false,
    dbNow: new Date('2026-11-25T10:00:00Z'),
    companies: [COMPANY],
    cutoff: new Date('2026-11-25T09:00:00Z'),
    cutoffSeq: '42',
    ...patch,
  };
  const cleared: string[] = [];
  const alerts: unknown[] = [];
  let counter = 0;
  const deps: RecoverCommissionRemindersDeps = {
    database: readersOf(state),
    store,
    schedule,
    ids: { newId: () => `pass-${(counter += 1)}` },
    clock: { now: clock.now },
    logger: fakeLogger(alerts) as never,
    release: 'worker',
    clearIncident: async (input) => {
      cleared.push(input.incidentId);
      store.calls.push('clear');
      return true;
    },
  };
  return { store, schedule, clock, state, cleared, alerts, deps };
}

/** شهادة سليمة من نفس جيل Redis. */
export function sentinel(store: FakeStore, cutoffSeq = '42'): void {
  store.sentinel = {
    release: 'worker',
    runId: RUN_ID,
    passId: 'published-pass',
    cutoff: new Date('2026-11-25T09:00:00Z').toISOString(),
    cutoffSeq,
  };
}
