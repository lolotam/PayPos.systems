import { commissionPlanVersionList } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { insertPlanVersion } from '../persistence/commission-plan-version-writer.ts';
import { listCommissionPlanVersionsStatement } from '../queries/commission-plan-versions.query.ts';
import {
  closeCommissionFixture,
  commissionPlanInput,
  commissionPlanVersionsFixture,
  ids,
  type CommissionPlanFixture,
} from './commission-plan-versions.fixture.ts';

let f: CommissionPlanFixture;

beforeAll(async () => {
  f = await commissionPlanVersionsFixture();
  for (const key of ['kind-v1', 'kind-v2']) {
    expect((await f.post(commissionPlanInput(), key)).status).toBe(201);
  }
  const ordinary = (await f.list({ limit: 1 })).items[0];
  if (ordinary === undefined) throw new Error('The fixture stored no ordinary version');
  await f.db.withTenant(f.company, async (tx) => {
    for (const version of [3, 4, 5]) {
      await insertPlanVersion(tx, f.company, f.business, {
        ...ordinary,
        id: ids.newId(),
        version,
        effective_from: '2026-09-01',
        whole_period: false,
        repair_period: '2026-09',
      });
    }
  });
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

it('the default list still shows repair versions, newest first', async () => {
  const page = await f.list({ limit: 3 });
  expect(page.items.map(({ version, repair_period }) => [version, repair_period])).toEqual([
    [5, '2026-09'],
    [4, '2026-09'],
    [3, '2026-09'],
  ]);
});

it('kind=ordinary drops repair versions before the LIMIT, so one row is the newest ordinary version', async () => {
  const page = await f.list({ limit: 1, kind: 'ordinary' });
  expect(page.items.map(({ version, repair_period }) => [version, repair_period])).toEqual([
    [2, null],
  ]);
  expect(page.next_cursor).toBe(2);
  const rest = await f.list({ limit: 1, kind: 'ordinary', cursor: 1 });
  expect(rest.items).toEqual([]);
  expect(rest.next_cursor).toBeNull();
});

it('kind=ordinary goes through the same guarded route and an unknown kind is a documented 400', async () => {
  const http = await f.get('?kind=ordinary&limit=1');
  expect(http.status).toBe(200);
  expect(commissionPlanVersionList.parse(http.body).items.map(({ version }) => version)).toEqual([
    2,
  ]);
  const bad = await f.get('?kind=repair');
  expect([bad.status, bad.body['code']]).toEqual([400, 'VALIDATION_FAILED']);
});

it('EXPLAIN ANALYZE of the ordinary-only read still uses commission_plan_versions_employee_idx', async () => {
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listCommissionPlanVersionsStatement(f.company, f.business, f.employee, { limit: 2, kind: 'ordinary' })}`,
    );
  });
  const text = JSON.stringify(plan);
  expect(text).toContain('commission_plan_versions_employee_idx');
  expect(text).not.toContain('Seq Scan');
});
