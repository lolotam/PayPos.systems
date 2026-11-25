import { describe, expect, it } from 'vitest';
import {
  COMMISSION_REMINDER_ALERT_COMPANY_PARKED,
  COMMISSION_REMINDER_SCHEDULES_LOST_CODE,
} from '@pospay/domain';

import {
  recoverCommissionReminders,
  RecoveryLeaseKeeper,
  type RecoverCommissionRemindersDeps,
} from '../recover-commission-reminders.ts';
import { COMPANY, harness, sentinel } from './recovery-harness.ts';

const LOST = COMMISSION_REMINDER_SCHEDULES_LOST_CODE;
const openFlag = (id: string) => ({ id, code: LOST, raisedAt: new Date('2026-11-25T08:00:00Z') });

describe('recoverCommissionReminders — certificate and exits', () => {
  it('publishes a certificate after rebuilding every company (P3-6)', async () => {
    const h = harness();
    sentinel(h.store);
    const result = await recoverCommissionReminders(h.deps, { mode: 'STARTUP' });

    expect(result.outcome).toBe('PUBLISHED');
    expect(h.store.published).toBe(1);
    expect(h.store.sentinel?.passId).toBe('pass-1');
    expect(h.schedule.registered).toEqual([COMPANY]);
  });

  it('takes nothing needed without acquiring the recovery key when healthy (P2-3)', async () => {
    const h = harness();
    sentinel(h.store);
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result.outcome).toBe('NOTHING_NEEDED');
    expect(h.store.acquireCalls).toBe(0);
    expect(h.store.published).toBe(0);
    expect(h.store.lease).toBeNull();
  });

  it('passes the sequence fence to the parked read (Item 2)', async () => {
    const h = harness();
    sentinel(h.store, '77');
    const seen: string[] = [];
    const deps: RecoverCommissionRemindersDeps = {
      ...h.deps,
      database: {
        ...h.deps.database,
        parkedCompanyCreatedAfter: async (_cutoff, cutoffSeq) => {
          seen.push(cutoffSeq);
          return { companyIds: [], overflow: false, dbNow: new Date('2026-11-25T10:00:00Z') };
        },
      },
    };
    await recoverCommissionReminders(deps, { mode: 'DETECT' });

    expect(seen).toEqual(['77']);
  });

  it('treats a clock regression as an invalid certificate without raising an incident (Item 2)', async () => {
    const h = harness({ dbNow: new Date('2026-11-25T08:00:00Z') });
    sentinel(h.store);
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result.outcome).toBe('PUBLISHED');
    expect(h.store.invalidated).toBe(0);
    expect(h.state.flags).toEqual([]);
  });
});

describe('recoverCommissionReminders — incident adoption', () => {
  it('adopts the open incident and invalidates the certificate before the clear', async () => {
    const h = harness({ flags: [openFlag('incident-1')] });
    sentinel(h.store);
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result).toMatchObject({ outcome: 'PUBLISHED', incidentId: 'incident-1' });
    expect(h.cleared).toEqual(['incident-1']);
    expect(h.store.calls).toEqual(['invalidate', 'clear', 'publish']);
  });

  it('keeps an open incident visible even when the certificate is valid (the incident wins)', async () => {
    const h = harness({ flags: [openFlag('incident-1')] });
    sentinel(h.store);
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result.outcome).not.toBe('NOTHING_NEEDED');
    expect(h.store.sentinel?.passId).toBe('pass-1');
  });

  it('raises and adopts an incident at once when a start-up pass finds a missing scheduler', async () => {
    const h = harness();
    sentinel(h.store);
    h.schedule.missing.add(COMPANY);
    const result = await recoverCommissionReminders(h.deps, { mode: 'STARTUP' });

    const raised = h.state.flags.map((flag) => flag.code);
    expect(raised).toEqual([LOST]);
    expect(result).toMatchObject({ outcome: 'PUBLISHED', rebuilt: 1 });
    expect(h.store.calls).toEqual(['invalidate', 'clear', 'publish']);
    expect(h.store.published).toBe(1);
  });

  it('rebinds the pacing record to the incident raised during the rebuild', async () => {
    const h = harness();
    sentinel(h.store);
    h.schedule.missing.add(COMPANY);
    let slotAtClear: unknown = null;
    const deps: RecoverCommissionRemindersDeps = {
      ...h.deps,
      clearIncident: async () => {
        slotAtClear = h.store.slot;
        return true;
      },
    };
    await recoverCommissionReminders(deps, { mode: 'STARTUP' });

    expect(slotAtClear).toMatchObject({ incidentId: h.state.flags[0]?.id, slot: 0 });
  });

  it('raises an incident at once on a sentinel loss outside a start-up pass', async () => {
    const h = harness();
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(h.state.flags).toHaveLength(1);
    expect(result.incidentId).toBe(h.state.flags[0]?.id);
    expect(result.outcome).toBe('PUBLISHED');
    expect(h.store.sentinel).not.toBeNull();
  });
});

describe('recoverCommissionReminders — parked company events (consumer specificity)', () => {
  it('ignores a parked event whose commission scheduler exists', async () => {
    const h = harness({ parkedCompanyIds: [COMPANY] });
    sentinel(h.store);
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result.outcome).toBe('NOTHING_NEEDED');
    expect(h.alerts).toEqual([]);
    expect(h.store.published).toBe(0);
  });

  it('starts a pass and raises the parked alert when the scheduler is missing', async () => {
    const h = harness({ parkedCompanyIds: [COMPANY] });
    sentinel(h.store);
    h.schedule.missing.add(COMPANY);
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result.outcome).toBe('PUBLISHED');
    expect(h.alerts).toContainEqual(
      expect.objectContaining({ code: COMMISSION_REMINDER_ALERT_COMPANY_PARKED, companies: 1 }),
    );
    expect(h.schedule.registered).toEqual([COMPANY]);
  });

  it('treats an overflowing parked read as active without listing schedulers', async () => {
    const h = harness({ overflow: true });
    sentinel(h.store);
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result.outcome).toBe('PUBLISHED');
    expect(h.alerts).toContainEqual(
      expect.objectContaining({ code: COMMISSION_REMINDER_ALERT_COMPANY_PARKED }),
    );
  });
});

describe('recoverCommissionReminders — bounded non-page operations and ownership checks', () => {
  it('aborts and releases the lease if openRecoveryFlags or sampleReminderRecoveryCutoff hangs (P2-4)', async () => {
    const h = harness();
    sentinel(h.store);
    const hungFlags: RecoverCommissionRemindersDeps = {
      ...h.deps,
      pageDeadlineMs: 10,
      database: {
        ...h.deps.database,
        openRecoveryFlags: () => new Promise<never>(() => undefined),
      },
    };
    const r1 = await recoverCommissionReminders(hungFlags, { mode: 'STARTUP' });
    expect([r1.outcome, h.store.lease, h.store.published]).toEqual(['FAILED', null, 0]);

    const h2 = harness();
    sentinel(h2.store);
    const hungCutoff: RecoverCommissionRemindersDeps = {
      ...h2.deps,
      pageDeadlineMs: 10,
      database: {
        ...h2.deps.database,
        sampleReminderRecoveryCutoff: () => new Promise<never>(() => undefined),
      },
    };
    const r2 = await recoverCommissionReminders(hungCutoff, { mode: 'STARTUP' });
    expect([r2.outcome, h2.store.lease, h2.store.published]).toEqual(['FAILED', null, 0]);
  });

  it('does not insert a flag if lease ownership is lost before raising an incident (P3-2)', async () => {
    const h = harness();
    h.store.renewResult = false;
    const result = await recoverCommissionReminders(h.deps, { mode: 'DETECT' });

    expect(result.outcome).toBe('FAILED');
    expect(h.state.flags).toEqual([]);
    expect(h.store.lease).toBeNull();
  });

  it('bounds stalled release cleanup and refuses final renewal once keeper records loss', async () => {
    const h = harness();
    h.deps.store.release = () => new Promise<boolean>(() => undefined);
    const hungRelease: RecoverCommissionRemindersDeps = {
      ...h.deps,
      pageDeadlineMs: 10,
      database: {
        ...h.deps.database,
        openRecoveryFlags: () => new Promise<never>(() => undefined),
      },
    };
    const r1 = await recoverCommissionReminders(hungRelease, { mode: 'STARTUP' });
    expect(r1.outcome).toBe('FAILED');

    const h2 = harness();
    h2.store.renewResult = false;
    const keeper = new RecoveryLeaseKeeper(h2.store, 'pass-x', h2.store.runId, h2.deps.logger);
    expect(await keeper.renew()).toBe(false);
    expect(keeper.lost).toBe(true);
    h2.store.renewResult = true;
    expect(await keeper.renew()).toBe(false);
  });
});
