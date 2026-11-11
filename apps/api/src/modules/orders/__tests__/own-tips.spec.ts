import { afterAll, beforeAll, expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import { ownWorkReads } from '../orders.module.ts';
import { ownTipsStatement, readOwnTips } from '../queries/own-tips.query.ts';
import { interceptDatabase } from '../../../../test/service-session.fixture.ts';
import {
  must,
  pairLine,
  recordVisit,
  runTips,
  tip,
  tipFixture,
  tipInput,
  type TipFixture,
} from '../../../../test/session-tips.fixture.ts';

let f: TipFixture;
const now = new Date('2026-10-15T08:00:00Z');
beforeAll(async () => {
  f = await tipFixture();
  await f.linkEmployee(must(f.employees[0]), f.ownerId);
});
afterAll(async () => {
  await f?.close();
});
const context = () => ({ companyId: f.company, businessId: f.business, userId: f.ownerId });
const read = (query: unknown = {}) =>
  f.db.withTenant(f.company, (tx) => readOwnTips(tx, context(), query, now, ownWorkReads));

it('MY08 sums own CASH/CARD from the current revision, excluding superseded and colleague tips', async () => {
  const visit = await recordVisit(f, [pairLine(f)]);
  await runTips(
    f,
    visit.sessionId,
    tipInput([tip(f, 0, 'CASH', '8.000'), tip(f, 1, 'CARD', '90.000')]),
  );
  await runTips(
    f,
    visit.sessionId,
    tipInput([tip(f, 0, 'CASH', '1.501'), tip(f, 0, 'CARD', '2.249')], {
      expected_revision: 1,
      reason: 'Synthetic replacement',
    }),
  );
  expect(await read()).toEqual({
    month: '2026-10',
    status: 'VISIBLE',
    total_cash: '1.501',
    total_card: '2.249',
  });
  expect(await read({ month: '2026-09' })).toEqual({
    month: '2026-09',
    status: 'VISIBLE',
    total_cash: '0.000',
    total_card: '0.000',
  });
});

it('HIDDEN checks authority/window first and performs no tip query or aggregation', async () => {
  const statements: string[] = [];
  const db = interceptDatabase(f.db, async (statement) => {
    statements.push(statement);
  });
  const hidden = {
    ...ownWorkReads,
    allowed: async () => new Set<never>(),
    tipTotals: () => {
      throw new Error('Hidden tips must not aggregate');
    },
  };
  const response = await db.withTenant(f.company, (tx) =>
    readOwnTips(tx, context(), {}, now, hidden),
  );
  expect(response).toEqual({ month: '2026-10', status: 'HIDDEN' });
  expect(statements.join('\n')).not.toMatch(/session_tips|session_tip_revisions/);
  await expect(
    db.withTenant(f.company, (tx) => readOwnTips(tx, context(), { month: '2026-08' }, now, hidden)),
  ).rejects.toMatchObject({ code: 'MY_PERIOD_OUT_OF_RANGE' });
  await f.linkEmployee(must(f.employees[0]), null);
  try {
    await expect(
      db.withTenant(f.company, (tx) => readOwnTips(tx, context(), { month: 'bad' }, now, hidden)),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  } finally {
    await f.linkEmployee(must(f.employees[0]), f.ownerId);
  }
});

async function seedBusyMonth() {
  for (let batch = 0; batch < 60; batch++) {
    await Promise.all(
      Array.from({ length: batch === 0 ? 9 : 10 }, async (_, index) => {
        const visit = await recordVisit(f);
        await runTips(
          f,
          visit.sessionId,
          tipInput([
            tip(f, 0, 'CASH', '0.001'),
            ...(batch === 0 && index === 0 ? [tip(f, 0, 'CARD', '0.001')] : []),
          ]),
        );
        return visit;
      }),
    );
  }
}

it('measures query, materialisation and aggregation time/memory on exactly 600 visits and 602 own current-revision tips', async () => {
  await seedBusyMonth();
  await f.h.owner.unsafe('ANALYZE service_sessions, session_tip_revisions, session_tips');
  const visits = await f.h
    .owner`SELECT count(*)::int AS count FROM service_sessions WHERE company_id=${f.company} AND business_id=${f.business}`;
  expect(visits[0]?.['count']).toBe(600);
  const metrics = await f.db.withTenant(f.company, async (tx) => {
    const memoryBefore = process.memoryUsage();
    const started = performance.now();
    const raw = await tx.execute<{ method: 'CASH' | 'CARD'; amount: string }>(
      ownTipsStatement(context(), must(f.employees[0]), '2026-10'),
    );
    const queried = performance.now();
    const entries = [...raw];
    const materialised = performance.now();
    const totals = ownWorkReads.tipTotals(entries);
    const finished = performance.now();
    return {
      rows: entries.length,
      totals,
      query_ms: queried - started,
      materialisation_ms: materialised - queried,
      aggregation_ms: finished - materialised,
      total_ms: finished - started,
      heap_delta_bytes: process.memoryUsage().heapUsed - memoryBefore.heapUsed,
      rss_delta_bytes: process.memoryUsage().rss - memoryBefore.rss,
    };
  });
  expect(metrics.rows).toBe(602);
  expect(metrics.totals).toEqual({ total_cash: '2.100', total_card: '2.250' });
  expect(metrics.total_ms).toBeLessThan(200);
  console.info('57-2 tips measurement', JSON.stringify(metrics));
  await explainBusyMonth();
}, 900_000);

async function explainBusyMonth() {
  const plan = await f.db.withTenant(f.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
    ${ownTipsStatement(context(), must(f.employees[0]), '2026-10')}`),
  );
  expect(JSON.stringify(plan)).toContain('session_tip_revisions_session_revision_uq');
  console.info('57-2a tips plan', JSON.stringify(plan));
}
