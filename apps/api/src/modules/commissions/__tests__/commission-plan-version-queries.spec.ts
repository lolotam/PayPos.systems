import { commissionPlanVersionList } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { businessTimeZone } from '../../../../test/harness.ts';
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
  for (const key of ['query-v1', 'query-v2', 'query-v3']) {
    const response = await f.post(commissionPlanInput(), key);
    expect(response.status).toBe(201);
  }
});
afterAll(async () => {
  await closeCommissionFixture(f);
});

it('the GET query returns the exact DTO shape newest first with stable cursor pages', async () => {
  const first = await f.list({ limit: 2 });
  expect(commissionPlanVersionList.parse(first)).toEqual(first);
  expect(first.items.map(({ version }) => version)).toEqual([3, 2]);
  expect(first.next_cursor).toBe(2);
  expect(first.items[0]).toMatchObject({
    employee_id: f.employee,
    effective_from: '2026-10-30',
    whole_period: false,
    repair_period: null,
    created_by: f.userId,
  });
  const second = await f.list(
    first.next_cursor === null ? { limit: 2 } : { limit: 2, cursor: first.next_cursor },
  );
  expect(second.items.map(({ version }) => version)).toEqual([1]);
  expect(second.next_cursor).toBeNull();
  const http = await f.get('?limit=2');
  expect(http.status).toBe(200);
  expect(http.body).toEqual(first);
});

/**
 * القائمة بتحرس الحد من غير ما توصل قاعدة البيانات (المهمة 696): رقم الإصدار عمود PostgreSQL
 * integer، فأقصى مؤشر مقبول هو 2147483647 وبعده الصفحة ترجع عادية، وقيمة واحدة فوق الحد يرفضها
 * التحقق قبل الـ SQL بغلاف الخطأ الموثق بدل ما توصل PostgreSQL وتنتهي 500.
 */
it.each([
  [
    'the cursor at the PostgreSQL integer maximum reads as a documented page',
    2147483647,
    (response: Awaited<ReturnType<CommissionPlanFixture['get']>>) => {
      expect(response.status).toBe(200);
      const body = commissionPlanVersionList.parse(response.body);
      expect(body.items.map(({ version }) => version)).toEqual([3, 2, 1]);
      expect(body.next_cursor).toBeNull();
    },
  ],
  [
    'a cursor above the PostgreSQL integer maximum is the documented refusal, never a 500',
    2147483648,
    (response: Awaited<ReturnType<CommissionPlanFixture['get']>>) => {
      expect(response.status).toBe(400);
      expect(response.body['code']).toBe('VALIDATION_FAILED');
      expect(response.body['details']).toEqual([{ path: ['cursor'], code: expect.any(String) }]);
    },
  ],
])('%s', async (_title, cursor, read) => {
  read(await f.get(`?cursor=${cursor}`));
});

it('EXPLAIN ANALYZE uses commission_plan_versions_employee_idx and no sequential scan', async () => {
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${listCommissionPlanVersionsStatement(f.company, f.business, f.employee, { limit: 2 })}`,
    );
  });
  const text = JSON.stringify(plan);
  expect(text).toContain('commission_plan_versions_employee_idx');
  expect(text).not.toContain('Seq Scan');
});

it('the root-bound business timezone reader returns the zone or null for an unknown business', async () => {
  const result = await f.db.withTenant(f.company, async (tx) => ({
    known: await businessTimeZone(tx, f.company, f.business),
    missing: await businessTimeZone(tx, f.company, ids.newId()),
  }));
  expect(result).toEqual({ known: 'Asia/Kuwait', missing: null });
});

it('GET returns EMPLOYEE_NOT_FOUND for an employee outside the business', async () => {
  const response = await f.get('', ids.newId());
  expect([response.status, response.body['code']]).toEqual([404, 'EMPLOYEE_NOT_FOUND']);
});
