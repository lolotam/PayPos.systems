import { afterAll, beforeAll, expect, it } from 'vitest';
import { holdVisit, waitForAdvisory } from '../../../../test/session-tips.fixture.ts';
import { ordersLineCancels } from '../orders.module.ts';
import { CancelServiceLineUseCase } from '../use-cases/cancel-service-line/cancel-service-line.usecase.ts';
import { cancelInput, cancelQuiet, runCancel } from './line-cancel.helpers.ts';
import { performersFixture, type PerformersFixture } from './line-performers.helpers.ts';
import { packageEvents, packageState, redeemedVisit } from './package-cancel.fixture.ts';
import { packageLine } from './package-redemption.fixture.ts';
import { AT, ids, interceptDatabase } from './session.fixture.ts';

let f: PerformersFixture;
beforeAll(async () => { f = await performersFixture(); });
afterAll(async () => { await f?.close(); });

it('RC-04 rechecks expiring cancellation authority after waiting for the component', async () => {
  const visit = await redeemedVisit(f);
  const before = await packageState(f, visit);
  f.setAt(new Date('2026-10-15T07:59:30Z'));
  await f.h.owner`UPDATE memberships SET ends_at='2026-10-15T08:00:00Z'
    WHERE company_id=${f.company} AND user_id=${f.editorId}`;
  const real = ordersLineCancels(f.db);
  const cancel = new CancelServiceLineUseCase({
    run: (context, work) => real.run(context, (tx) => work({ ...tx,
      lines: { ...tx.lines, lockRedemptionComponent: async (request) => {
        const redemption = await tx.lines.lockRedemptionComponent(request);
        f.setAt(new Date('2026-10-15T08:00:30Z'));
        return redemption;
      } },
    })),
  }, ids, f.clock);
  const key = ids.newId();
  try {
    await expect(cancel.execute({ ...f.context(key, f.editorId), sessionId: visit.sessionId,
      lineId: visit.lineId, input: cancelInput() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await packageState(f, visit)).toEqual(before);
    expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    f.setAt(AT);
    await f.h.owner`UPDATE memberships SET ends_at=NULL WHERE company_id=${f.company} AND user_id=${f.editorId}`;
  }
});

it('RC rollback undoes the reversal, history and audit after an event failure', async () => {
  const visit = await redeemedVisit(f);
  const before = await packageState(f, visit);
  const real = ordersLineCancels(f.db);
  const failure = new Error('Synthetic event failure');
  const cancel = new CancelServiceLineUseCase({
    run: (context, work) => real.run(context, (tx) => work({ ...tx,
      emit: async () => { throw failure; },
    })),
  }, ids, f.clock);
  const key = ids.newId();
  await expect(cancel.execute({ ...f.context(key, f.editorId), sessionId: visit.sessionId,
    lineId: visit.lineId, input: cancelInput() })).rejects.toThrow('SESSION_PERSISTENCE_FAILED');
  expect(await packageState(f, visit)).toEqual(before);
  expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
});

it('RC-03 concurrent same-key cancels reverse exactly once and replay equally', async () => {
  const visit = await redeemedVisit(f);
  const held = await holdVisit(f, visit.sessionId);
  const key = ids.newId();
  const pending = Promise.allSettled([
    runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key }),
    runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key }),
  ]);
  try { expect(await waitForAdvisory(f, held.pid, 1)).toBeGreaterThanOrEqual(1); }
  finally { await held.release(); }
  const results = await pending;
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
  if (results[0]?.status === 'fulfilled' && results[1]?.status === 'fulfilled') {
    expect(results[0].value).toEqual(results[1].value);
  }
  expect((await packageState(f, visit))['cancellations']).toHaveLength(1);
  expect(await packageEvents(f, visit)).toHaveLength(1);
});

it('RC-03 different-key concurrent cancels leave one history and one reversal', async () => {
  const visit = await redeemedVisit(f);
  const results = await Promise.allSettled([
    runCancel(f, visit.sessionId, visit.lineId),
    runCancel(f, visit.sessionId, visit.lineId),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected');
  if (rejected?.status === 'rejected') expect(rejected.reason).toMatchObject({ code: 'SESSION_LINE_REVISION_STALE' });
  expect((await packageState(f, visit))['cancellations']).toHaveLength(1);
  expect(await packageEvents(f, visit)).toHaveLength(1);
});

it('RC-02 concurrent redeem and cancel conserve the single slot', async () => {
  const visit = await redeemedVisit(f, 1);
  const results = await Promise.allSettled([
    runCancel(f, visit.sessionId, visit.lineId),
    f.create.execute({ ...f.context(ids.newId()), input: f.body([packageLine(f, visit.entitlement)]) }),
  ]);
  expect(results[0]?.status).toBe('fulfilled');
  const redeemed = results[1];
  if (redeemed?.status === 'rejected') expect(redeemed.reason).toMatchObject({ code: 'PACKAGE_NO_FREE_SESSION' });
  const [counts] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM package_redemptions WHERE company_id=${f.company}
      AND entitlement_id=${visit.entitlement} AND reversed_at IS NULL) AS live,
    (SELECT count(*)::int FROM package_session_slots WHERE company_id=${f.company}
      AND entitlement_id=${visit.entitlement} AND state='USED') AS used`;
  const expected = redeemed?.status === 'fulfilled' ? 1 : 0;
  expect(counts).toEqual({ live: expected, used: expected });
  expect((await packageState(f, visit))['cancellations']).toHaveLength(1);
});

it.each(['UPDATE package_session_slots', 'UPDATE service_lines', 'INSERT INTO service_line_cancellations'])(
  'RC rollback restores the entire cancellation when %s fails', async (statement) => {
    const visit = await redeemedVisit(f);
    const before = await packageState(f, visit);
    const failure = new Error(`Synthetic cancellation failure: ${statement}`);
    const database = interceptDatabase(f.db, async (query) => {
      if (query.includes(statement)) throw failure;
    });
    const cancel = new CancelServiceLineUseCase(ordersLineCancels(database), ids, f.clock);
    const key = ids.newId();
    await expect(cancel.execute({ ...f.context(key, f.editorId), sessionId: visit.sessionId,
      lineId: visit.lineId, input: cancelInput() })).rejects.toThrow('SESSION_PERSISTENCE_FAILED');
    expect(await packageState(f, visit)).toEqual(before);
    expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
    await expect(runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key }))
      .resolves.toMatchObject({ line: { status: 'CANCELLED' } });
  },
);

it.each(['reversed', 'free'] as const)('RC-03b refuses forced stale %s state and rolls back all effects', async (kind) => {
  const visit = await redeemedVisit(f);
  // الحالة مستحيلة تحت التريغرز؛ تغيير owner محلي للاختبار وحده، ثم استعادة الحالة الأصلية.
  await f.h.owner.begin(async (tx) => {
    await tx`SET LOCAL session_replication_role=replica`;
    if (kind === 'reversed') {
      await tx`UPDATE package_redemptions SET reversed_at=now(),reversal_cancellation_id=${ids.newId()}
        WHERE company_id=${f.company} AND id=${visit.redemptionId}`;
    } else {
      await tx`UPDATE package_session_slots SET state='FREE',current_redemption_id=NULL
        WHERE company_id=${f.company} AND id=${visit.slotId}`;
    }
  });
  try {
    const stale = await packageState(f, visit);
    const key = ids.newId();
    await expect(runCancel(f, visit.sessionId, visit.lineId, cancelInput(), { key }))
      .rejects.toMatchObject({ code: 'PACKAGE_REDEMPTION_ALREADY_REVERSED' });
    expect(await packageState(f, visit)).toEqual(stale);
    expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
  } finally {
    await f.h.owner.begin(async (tx) => {
      await tx`SET LOCAL session_replication_role=replica`;
      await tx`UPDATE package_redemptions SET reversed_at=NULL,reversal_cancellation_id=NULL
        WHERE company_id=${f.company} AND id=${visit.redemptionId}`;
      await tx`UPDATE package_session_slots SET state='USED',current_redemption_id=${visit.redemptionId}
        WHERE company_id=${f.company} AND id=${visit.slotId}`;
    });
  }
});

it('RC-06b the database refuses a writer that cancels without returning the package session', async () => {
  const visit = await redeemedVisit(f);
  const before = await packageState(f, visit);
  const real = ordersLineCancels(f.db);
  const cancel = new CancelServiceLineUseCase({
    run: (context, work) => real.run(context, (tx) => work({ ...tx,
      lines: { ...tx.lines, reverseRedemption: async () => {} },
    })),
  }, ids, f.clock);
  const key = ids.newId();
  await expect(cancel.execute({ ...f.context(key, f.editorId), sessionId: visit.sessionId,
    lineId: visit.lineId, input: cancelInput() })).rejects.toThrow();
  expect(await packageState(f, visit)).toEqual(before);
  expect(await cancelQuiet(f, visit.sessionId, visit.lineId, key)).toEqual({ cancellations: 0, audits: 0, events: 0, keys: 0 });
});
