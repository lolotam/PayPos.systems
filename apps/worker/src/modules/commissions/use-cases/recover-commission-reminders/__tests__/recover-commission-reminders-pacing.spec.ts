import { describe, expect, it } from 'vitest';
import { COMMISSION_REMINDER_SCHEDULES_LOST_CODE } from '@pospay/domain';

import { dueRecoverySlot, recoverySlotDelayMs } from '../../../domain/reminder-recovery.ts';
import {
  recoverCommissionReminders,
  type RecoverCommissionRemindersDeps,
} from '../recover-commission-reminders.ts';
import { COMPANY, RUN_ID, harness, sentinel, type Harness } from './recovery-harness.ts';

const LOST = COMMISSION_REMINDER_SCHEDULES_LOST_CODE;
const ANCHOR = '2026-11-25T07:00:00.000Z';

/** يجهّز pass فاشل: التسجيل بيعلّق فبيوقف بعد مهلته، وسجل الإيقاع بيفضل. */
async function failedStartup(h: Harness): Promise<void> {
  h.schedule.missing.add(COMPANY);
  h.schedule.hang = 'register';
  const deps: RecoverCommissionRemindersDeps = { ...h.deps, upsertDeadlineMs: 10 };
  const result = await recoverCommissionReminders(deps, { mode: 'STARTUP' });
  expect(result.outcome).toBe('FAILED');
  h.schedule.hang = null;
}

describe('recoverCommissionReminders — stalled work (ADR-0061 §4 step 3)', () => {
  it.each([
    ['upsert', 'register', { upsertDeadlineMs: 10 }],
    ['schedule check', 'exists', { pageDeadlineMs: 10 }],
  ] as const)(
    'stops, frees the lease and publishes nothing on a stalled %s',
    async (_n, hang, limits) => {
      const h = harness();
      sentinel(h.store);
      h.schedule.missing.add(COMPANY);
      h.schedule.hang = hang;
      const result = await recoverCommissionReminders(
        { ...h.deps, ...limits },
        { mode: 'STARTUP' },
      );

      expect(result.outcome).toBe('FAILED');
      expect(h.store.lease).toBeNull();
      expect(h.store.published).toBe(0);
      expect(h.cleared).toEqual([]);
    },
  );

  it('stops on a stalled page read without clearing or publishing', async () => {
    const h = harness();
    sentinel(h.store);
    const deps: RecoverCommissionRemindersDeps = {
      ...h.deps,
      pageDeadlineMs: 10,
      database: { ...h.deps.database, companyIdPage: () => new Promise<never>(() => undefined) },
    };
    const result = await recoverCommissionReminders(deps, { mode: 'STARTUP' });

    expect(result.outcome).toBe('FAILED');
    expect(h.store.lease).toBeNull();
    expect(h.store.published).toBe(0);
  });
});

describe('recoverCommissionReminders — idle and hard deadlines (Item 1)', () => {
  it('ends a pass whose last progress is older than the maximum idle interval', async () => {
    const h = harness();
    sentinel(h.store);
    h.schedule.missing.add(COMPANY);
    const deps: RecoverCommissionRemindersDeps = {
      ...h.deps,
      schedule: {
        ...h.schedule,
        existsAll: async (ids: readonly string[]) => {
          h.clock.advance(100_000);
          return ids.map(() => false);
        },
        register: h.schedule.register.bind(h.schedule),
      } as unknown as RecoverCommissionRemindersDeps['schedule'],
    };
    const result = await recoverCommissionReminders(deps, { mode: 'STARTUP' });

    expect(result.outcome).toBe('FAILED');
    expect(h.schedule.registered).toEqual([]);
    expect(h.store.lease).toBeNull();
  });

  it('stops at the hard pass deadline and releases the lease (Item 1)', async () => {
    const h = harness();
    sentinel(h.store);
    const deps: RecoverCommissionRemindersDeps = {
      ...h.deps,
      database: {
        ...h.deps.database,
        companyIdPage: async () => {
          h.clock.advance(20 * 60_000);
          return [COMPANY];
        },
      },
    };
    const result = await recoverCommissionReminders(deps, { mode: 'STARTUP' });

    expect(result.outcome).toBe('FAILED');
    expect(h.store.published).toBe(0);
    expect(h.store.lease).toBeNull();
  });
});

describe('recoverCommissionReminders — start-up pacing (Item 4)', () => {
  it('lets the first start-up of a generation run and records its run id', async () => {
    const h = harness();
    sentinel(h.store);
    h.schedule.missing.add(COMPANY);
    h.schedule.hang = 'register';
    await recoverCommissionReminders({ ...h.deps, upsertDeadlineMs: 10 }, { mode: 'STARTUP' });

    expect(h.store.slot).toMatchObject({ startupRunId: RUN_ID });
  });

  it('refuses a serial replica restart after a failed attempt in the same slot', async () => {
    const h = harness();
    sentinel(h.store);
    await failedStartup(h);
    const second = await recoverCommissionReminders(h.deps, { mode: 'STARTUP' });

    expect(second.outcome).toBe('REFUSED_PACING');
    expect(h.store.lease).toBeNull();
  });

  it('runs the next slot of the shared schedule once it is due', async () => {
    const h = harness();
    sentinel(h.store);
    await failedStartup(h);
    h.clock.advance(61_000);
    const retried = await recoverCommissionReminders(h.deps, { mode: 'STARTUP' });

    expect(retried.outcome).toBe('PUBLISHED');
  });

  it('exempts a start-up from a pacing record written for another Redis generation', async () => {
    const h = harness();
    sentinel(h.store);
    h.store.slot = {
      incidentId: null,
      anchor: h.clock.now().toISOString(),
      slot: 0,
      startupRunId: 'old',
    };
    const result = await recoverCommissionReminders(h.deps, { mode: 'STARTUP' });

    expect(result.outcome).toBe('PUBLISHED');
  });
});

describe('recoverCommissionReminders — operator and pacing record (Items 5–7)', () => {
  it('stops a stale operator command without touching the slot record (Item 6)', async () => {
    const h = harness();
    sentinel(h.store);
    const slot = { incidentId: 'incident-1', anchor: ANCHOR, slot: 3 };
    h.store.slot = { ...slot };
    const result = await recoverCommissionReminders(h.deps, {
      mode: 'OPERATOR',
      incidentId: 'incident-9',
    });

    expect(result.outcome).toBe('STALE_OPERATOR_INCIDENT');
    expect([h.store.slot, h.cleared, h.store.published]).toEqual([slot, [], 0]);
  });

  it('skips the pacing refusal for the named open incident and records the slot (Item 6)', async () => {
    const h = harness({
      flags: [{ id: 'incident-1', code: LOST, raisedAt: new Date('2026-11-25T09:59:00Z') }],
    });
    sentinel(h.store);
    h.store.slot = { incidentId: 'incident-1', anchor: '2026-11-25T09:59:00.000Z', slot: 0 };
    const result = await recoverCommissionReminders(h.deps, {
      mode: 'OPERATOR',
      incidentId: 'incident-1',
    });

    expect(result).toMatchObject({ outcome: 'PUBLISHED', incidentId: 'incident-1' });
    expect(h.cleared).toEqual(['incident-1']);
  });

  it('raises the new loss on the first pass despite a closed incident record (Item 5)', async () => {
    const h = harness();
    h.store.slot = { incidentId: 'incident-1', anchor: ANCHOR, slot: 3 };
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(h.state.flags).toHaveLength(1);
    expect(result.outcome).toBe('PUBLISHED');
    expect(result.incidentId).toBe(h.state.flags[0]?.id);
  });

  it('does not exit when one trigger vanished but another is active (Item 7)', async () => {
    const h = harness({ flags: [{ id: 'incident-2', code: LOST, raisedAt: new Date(ANCHOR) }] });
    sentinel(h.store);
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result).toMatchObject({ outcome: 'PUBLISHED', incidentId: 'incident-2' });
  });
});

describe('recoverCommissionReminders — CodeRabbit pacing and validation edge cases', () => {
  it('rejects OPERATOR mode without an explicit open incident even when sentinel is missing', async () => {
    const h = harness();
    const result = await recoverCommissionReminders(h.deps, { mode: 'OPERATOR' });

    expect(result.outcome).toBe('STALE_OPERATOR_INCIDENT');
    expect([h.state.flags, h.store.published, h.store.lease]).toEqual([[], 0, null]);
  });

  it('uses the 0/1/3/7/15/30 ladder and uncaps dueRecoverySlot beyond 512 slots', () => {
    expect([0, 1, 2, 3, 4, 5].map((slot) => recoverySlotDelayMs(slot))).toEqual([
      0,
      60_000,
      3 * 60_000,
      7 * 60_000,
      15 * 60_000,
      30 * 60_000,
    ]);
    expect(dueRecoverySlot(recoverySlotDelayMs(600))).toBe(600);
    expect(dueRecoverySlot(Number.POSITIVE_INFINITY)).toBe(-1);
  });

  it('paces sequential startups even when the pacing key carries a closed incident', async () => {
    const h = harness();
    sentinel(h.store);
    h.store.slot = {
      incidentId: 'closed-incident',
      anchor: '2026-11-24T00:00:00.000Z',
      slot: 8,
      startupRunId: RUN_ID,
      startupAnchor: h.clock.now().toISOString(),
      startupSlot: 0,
    };
    h.store.sentinel = null;
    const result = await recoverCommissionReminders(h.deps, { mode: 'STARTUP' });

    expect(result.outcome).toBe('REFUSED_PACING');
    expect(h.store.published).toBe(0);
    expect(h.store.lease).toBeNull();
  });

  it('abandons without rebuilding if guarded writeSlot loses lease ownership', async () => {
    const h = harness();
    sentinel(h.store);
    h.deps.store.writeSlot = async () => false;
    const result = await recoverCommissionReminders(h.deps, { mode: 'STARTUP' });

    expect(result.outcome).toBe('FAILED');
    expect([h.schedule.registered, h.store.published]).toEqual([[], 0]);
  });
});
