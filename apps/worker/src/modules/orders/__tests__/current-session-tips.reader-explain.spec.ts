import { createDatabase, type Database, type Tx } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { sessionBranchesStatement } from '../queries/current-session-tips.reader.ts';

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Actual Rows'?: number;
  'Rows Removed by Filter'?: number;
  Plans?: PlanNode[];
}
const nodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(nodes)];
const must = <T>(value: T | null | undefined): T => {
  if (value === undefined || value === null) throw new Error('EXPLAIN_PLAN_MISSING');
  return value;
};

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const COMPANY = TENANT.A.company;
const BUSINESS = TENANT.A.business;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids });
  await seedManySessions();
  await owner`ANALYZE service_sessions`;
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

/** ستين ألف زيارة إضافية لنفس الشركة والنشاط، عشان بحث الفروع يمتح على جدول بحجم حقيقي. */
async function seedManySessions(): Promise<void> {
  await owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    occurred_at,recorded_at,business_date,business_timezone,recorded_by,recorded_by_membership_id,late)
    SELECT s.company_id, gen_random_uuid(), s.business_id, s.branch_id, s.customer_id, s.customer_name, s.customer_phone_masked,
      s.occurred_at, s.recorded_at, s.business_date - (g.n % 300), s.business_timezone, s.recorded_by, s.recorded_by_membership_id, s.late
    FROM generate_series(1, 60000) AS g(n)
    CROSS JOIN service_sessions s
    WHERE s.company_id = ${COMPANY} AND s.id = ${ORDER_IDS.session}`;
}

/** مخطط الـ EXPLAIN كقائمة مسطّحة، عشان نفحص كل عقدة فيه. */
async function explainPlan(tx: Tx, statement: SQL): Promise<PlanNode[]> {
  const rows = await tx.execute<{ 'QUERY PLAN': { Plan: PlanNode }[] }>(
    sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`,
  );
  return nodes(must(must(rows[0])['QUERY PLAN'][0]).Plan);
}

it('looks up the branch of 100 sessions by index without scanning the session table', async () => {
  // استعلام البقشيش المشترك ليه اختبار EXPLAIN خاص بيه في
  // apps/api/src/modules/orders/__tests__/session-tips-bootstrap-explain.spec.ts، وهذا الملف بيغطي بحث الفروع بس.
  // المخطط لازم يوصل لكل معرّف ب probe مفهرس، ويقرأ مية صف بس بلا مسح تسلسلي على جدول الزيارات.
  const picked = await owner`SELECT id FROM service_sessions
    WHERE company_id = ${COMPANY} AND business_id = ${BUSINESS} ORDER BY id LIMIT 100`;
  const sessionIds = picked.map((row) => String(row.id));
  await db.withTenant(COMPANY, async (tx) => {
    const statement = sessionBranchesStatement(COMPANY, BUSINESS, sessionIds);
    const plan = await explainPlan(tx, statement);
    const shape = JSON.stringify(
      plan.map((node) => ({
        type: node['Node Type'],
        relation: node['Relation Name'],
        index: node['Index Name'],
        rows: node['Actual Rows'],
      })),
    );
    const visits = plan.filter((node) => node['Relation Name'] === 'service_sessions');
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.every((node) => node['Node Type'] !== 'Seq Scan'), shape).toBe(true);
    // الفهرس على المعرّف هو اللي بيوصل لكل زيارة؛ المفتاح الأساسي مسمّى service_sessions_company_id_id_pk في المخطط.
    const used = plan.map((node) => node['Index Name']);
    expect(
      ['service_sessions_pkey', 'service_sessions_business_id_key', 'service_sessions_company_id_id_pk'].some(
        (name) => used.includes(name),
      ),
      shape,
    ).toBe(true);
    const scanned = visits.reduce((sum, node) => sum + (node['Actual Rows'] ?? 0), 0);
    const removed = visits.reduce((sum, node) => sum + (node['Rows Removed by Filter'] ?? 0), 0);
    expect(scanned, shape).toBeLessThanOrEqual(100);
    expect(removed).toBeLessThan(50);
    // نفس الاستعلام بيشتغل عادي وبيجيب مية زيارة بمعرّفاتها وفروعها كلها.
    const found = await tx.execute<{ id: string; branch_id: string }>(statement);
    expect(found).toHaveLength(100);
    expect(found.map((row) => row.id).sort()).toEqual([...sessionIds].sort());
    expect(found.every((row) => row.branch_id === TENANT.A.branch)).toBe(true);
  });
});
