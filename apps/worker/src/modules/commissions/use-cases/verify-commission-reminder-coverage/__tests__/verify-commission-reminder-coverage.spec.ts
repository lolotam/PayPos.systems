import { describe, expect, it, vi } from 'vitest';

import {
  createCommissionReminderCoverageSweeper,
  type VerifyCommissionReminderCoverageDeps,
} from '../verify-commission-reminder-coverage.ts';

const BOUNDS = { pageSize: 2, maxPages: 2, maxRestores: 3, sweepDeadlineMs: 60_000 };
const COMPANIES = ['c1', 'c2', 'c3', 'c4', 'c5'];
const SENTINEL = { release: 'r', runId: 'run', passId: 'p', cutoff: 'c', cutoffSeq: '1' };

/** قارئ شركات ثابت بيسجّل المؤشرات اللي اتطلبت منه. */
function companyReader(pages: Array<string | null>) {
  return {
    companyIdPage: vi.fn(async (after: string | null, size: number) => {
      pages.push(after);
      const start = after === null ? 0 : COMPANIES.indexOf(after) + 1;
      return COMPANIES.slice(start, start + size);
    }),
  };
}

/** جدولة وهمية: الموجود مجموعة بتكبر مع كل تسجيل. */
function fakeSchedule(initial: ReadonlySet<string>) {
  let present = initial;
  const register = vi.fn(async (id: string) => {
    present = new Set([...present, id]);
    return { registered: true };
  });
  const existsAll = vi.fn(async (ids: readonly string[]) => ids.map((id) => present.has(id)));
  return { register, existsAll };
}

/** يبني اعتماديات بشركات ثابتة وجدولات موجودة حسب المجموعة المعطاة. */
function build(
  initial: ReadonlySet<string>,
  overrides: Partial<{ lease: unknown; sentinel: unknown }> = {},
) {
  const pages: Array<string | null> = [];
  const schedule = fakeSchedule(initial);
  const snapshot = async () => ({
    sentinel: 'sentinel' in overrides ? overrides.sentinel : SENTINEL,
    lease: 'lease' in overrides ? overrides.lease : null,
    serverRunId: 'run',
  });
  const deps = {
    database: companyReader(pages),
    store: { snapshot: vi.fn(snapshot) },
    schedule,
    clock: { now: () => new Date() },
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
  } as unknown as VerifyCommissionReminderCoverageDeps;
  return { deps, register: schedule.register, pages };
}

describe('commission reminder coverage sweep', () => {
  it('registers only the absent schedulers and warns once with counts', async () => {
    const { deps, register } = build(new Set(['c1', 'c3', 'c4', 'c5']));

    const result = await createCommissionReminderCoverageSweeper(deps).run();

    expect(register.mock.calls).toEqual([['c2']]);
    expect(result).toMatchObject({ outcome: 'COMPLETED', scanned: 5, missing: 1, restored: 1 });
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('is bounded per sweep and resumes from the cursor on the next sweep', async () => {
    const { deps, pages } = build(new Set(COMPANIES));
    const sweeper = createCommissionReminderCoverageSweeper(deps, BOUNDS);

    const first = await sweeper.run();
    const second = await sweeper.run();

    expect(first).toMatchObject({ outcome: 'PARTIAL', scanned: 4 });
    expect(second).toMatchObject({ outcome: 'COMPLETED', scanned: 1 });
    expect(pages).toEqual([null, 'c2', 'c4']);
  });

  it('caps restores per sweep and rescans the same page afterwards', async () => {
    const { deps, register } = build(new Set());
    const sweeper = createCommissionReminderCoverageSweeper(deps, BOUNDS);

    const first = await sweeper.run();

    expect(register).toHaveBeenCalledTimes(3);
    expect(first).toMatchObject({ outcome: 'PARTIAL', restored: 3 });
    const second = await sweeper.run();
    expect(second.restored).toBe(2);
  });

  it('skips while a recovery pass holds the lease or the certificate is missing', async () => {
    const leased = build(new Set(), { lease: { passId: 'p', runId: 'run', incidentId: null } });
    const missing = build(new Set(), { sentinel: null });

    expect(await createCommissionReminderCoverageSweeper(leased.deps).run()).toMatchObject({
      outcome: 'SKIPPED',
      skipReason: 'RECOVERY_IN_PROGRESS',
    });
    expect(await createCommissionReminderCoverageSweeper(missing.deps).run()).toMatchObject({
      outcome: 'SKIPPED',
      skipReason: 'CERTIFICATE_NOT_HEALTHY',
    });
    expect(leased.register).not.toHaveBeenCalled();
    expect(missing.deps.database.companyIdPage).not.toHaveBeenCalled();
  });
});

describe('commission reminder coverage sweep guards', () => {
  it('refuses an overlapping sweep while one is still running', async () => {
    const { deps } = build(new Set(COMPANIES));
    let release: (page: readonly string[]) => void = () => undefined;
    deps.database.companyIdPage = vi.fn(
      () => new Promise<readonly string[]>((resolve) => (release = resolve)),
    );
    const sweeper = createCommissionReminderCoverageSweeper(deps);

    const running = sweeper.run();
    expect(await sweeper.run()).toMatchObject({ outcome: 'BUSY' });
    await vi.waitFor(() => expect(deps.database.companyIdPage).toHaveBeenCalled());
    release([]);

    expect(await running).toMatchObject({ outcome: 'COMPLETED' });
  });

  it('keeps the cursor when a read fails so the next sweep retries the same page', async () => {
    const { deps, pages } = build(new Set(COMPANIES));
    const sweeper = createCommissionReminderCoverageSweeper(deps, { ...BOUNDS, maxPages: 1 });
    await sweeper.run();
    const readPage = deps.database.companyIdPage;
    deps.database.companyIdPage = vi.fn().mockRejectedValue(new Error('db down'));

    expect(await sweeper.run()).toMatchObject({ outcome: 'FAILED' });
    deps.database.companyIdPage = readPage;
    await sweeper.run();

    expect(pages).toEqual([null, 'c2']);
    expect(deps.logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('commission reminder coverage sweep bounds', () => {
  it('does not freeze the cursor on one page when every registration is refused', async () => {
    const { deps, pages } = build(new Set());
    deps.schedule.register = vi.fn(async () => ({ registered: false }));
    const sweeper = createCommissionReminderCoverageSweeper(deps, {
      ...BOUNDS,
      maxPages: 5,
      maxRestores: 1,
    });

    const first = await sweeper.run();
    const second = await sweeper.run();

    expect(first).toMatchObject({ outcome: 'COMPLETED', scanned: 5, missing: 5, restored: 0 });
    expect(second).toMatchObject({ outcome: 'COMPLETED', scanned: 5 });
    expect(pages).toEqual([null, 'c2', 'c4', null, 'c2', 'c4']);
  });

  it('wraps the cursor back to the first company after a completed sweep', async () => {
    const { deps, pages } = build(new Set(COMPANIES));
    const sweeper = createCommissionReminderCoverageSweeper(deps, { ...BOUNDS, maxPages: 5 });

    const first = await sweeper.run();
    const second = await sweeper.run();

    expect(first).toMatchObject({ outcome: 'COMPLETED', scanned: 5 });
    expect(second).toMatchObject({ outcome: 'COMPLETED', scanned: 5 });
    expect(pages).toEqual([null, 'c2', 'c4', null, 'c2', 'c4']);
  });

  it('stops between pages when a recovery pass takes the lease mid-sweep', async () => {
    const { deps, register, pages } = build(new Set());
    const lease = { passId: 'p', runId: 'run', incidentId: null };
    let reads = 0;
    deps.store.snapshot = vi.fn(async () => ({
      sentinel: SENTINEL,
      lease: ++reads === 2 ? lease : null,
      serverRunId: 'run',
    })) as unknown as typeof deps.store.snapshot;
    const sweeper = createCommissionReminderCoverageSweeper(deps, { ...BOUNDS, maxRestores: 10 });

    const result = await sweeper.run();

    expect(result).toMatchObject({ outcome: 'SKIPPED', skipReason: 'RECOVERY_IN_PROGRESS' });
    expect(register).toHaveBeenCalledTimes(2);
    expect(pages).toEqual([null]);
    await sweeper.run();
    expect(pages).toEqual([null, 'c2', 'c4']);
  });

  it('stops registering inside a page once the sweep deadline has passed', async () => {
    const { deps, register } = build(new Set());
    let now = 0;
    Object.assign(deps, { clock: { now: () => new Date(now) } });
    deps.schedule.register = vi.fn(async () => {
      now += 40_000;
      return { registered: true };
    });
    const sweeper = createCommissionReminderCoverageSweeper(deps, { ...BOUNDS, maxRestores: 10 });

    const result = await sweeper.run();

    expect(result).toMatchObject({ outcome: 'PARTIAL', restored: 2 });
    expect(register).not.toHaveBeenCalled();
    expect(deps.schedule.register).toHaveBeenCalledTimes(2);
  });
});
