import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, SYSTEM_ROLES, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import {
  seedTwoTenants,
  TENANT,
  USER,
} from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  discountApproverCandidatesStatement,
  discountApproverGrantsStatement,
  discountApproverRecipients,
} from '../persistence/discount-approver-recipients.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
// عضوية البذرة تبدأ بـ now()، فنقطة بعيدة في المستقبل تجعلها سارية بلا تعديل على البذرة.
const AT = new Date('2099-01-01T00:00:00.000Z');
// دور الكاشير بلا صلاحية الموافقة، فالعضويات المزروعة تبقى خارج دائرة الموافقين.
const CASHIER_ROLE_ID = SYSTEM_ROLES.find((role) => role.code === 'cashier')?.id ?? '';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

it('the seed owner approves at its branch, and another company stays invisible', async () => {
  const recipients = await db.withTenant(TENANT.A.company, (tx) =>
    discountApproverRecipients(tx, TENANT.A.company, TENANT.A.business, TENANT.A.branch, AT),
  );
  expect(recipients).toEqual([USER]);
  const foreign = await db.withTenant(TENANT.A.company, (tx) =>
    discountApproverRecipients(tx, TENANT.B.company, TENANT.B.business, TENANT.B.branch, AT),
  );
  expect(foreign).toEqual([]);
});

it('the candidate statement finds the company arm by its scope index on its own', async () => {
  await seedOutOfScopeMemberships(TENANT.A.company);
  await owner`ANALYZE memberships`;
  const plan = await planOf(
    discountApproverCandidatesStatement(TENANT.A.company, TENANT.A.business, TENANT.A.branch, AT),
  );
  const scans = planNodes(plan).filter((node) => node['Relation Name'] === 'memberships');
  const companyArm = scans.find((node) => {
    const condition = String(node['Index Cond'] ?? '');
    return condition.includes('scope_type') && condition.includes('scope_id');
  });
  expect(companyArm?.['Index Name']).toBe('memberships_scope_idx');
  expect(scans.some((node) => node['Node Type'] === 'Seq Scan')).toBe(false);
  for (const node of scans)
    expect(Number(node['Rows Removed by Filter'] ?? 0)).toBeLessThanOrEqual(5);
}, 120_000);

it('the grants statement uses tenant indexes', async () => {
  const grants = JSON.stringify(
    await explain(
      discountApproverGrantsStatement(TENANT.A.company, TENANT.A.business, TENANT.A.branch, AT, [
        USER,
      ]),
    ),
  );
  expect(grants).toMatch(/memberships_(pkey|scope_business_idx|scope_branch_idx|user_id_idx)/);
  expect(grants).toMatch(/role_permissions_[a-z_]+/);
  expect(grants).toMatch(/permission_overrides_[a-z_]+/);
  expect(grants).not.toContain('Seq Scan');
});

/** عضويات كثيرة خارج النطاق المطلوب: أنشطة وفروع جديدة لنفس الشركة، فلا يبقى اختيار الفهرس مضموماً. */
async function seedOutOfScopeMemberships(company: string): Promise<void> {
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type)
    SELECT ${company}, gen_random_uuid(), 'Bulk business', 'salon' FROM generate_series(1,20) gs(n)`;
  await owner`INSERT INTO branches(company_id,id,business_id,name_en)
    SELECT b.company_id, gen_random_uuid(), b.id, 'Bulk branch' FROM businesses b
    WHERE b.company_id=${company} AND b.name_en='Bulk business'`;
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    SELECT gen_random_uuid(), 'Bulk member', gen_random_uuid()::text||'@example.test', true, now(), now()
    FROM generate_series(1,300) gs(n)`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${company}, gen_random_uuid(), u.id, ${CASHIER_ROLE_ID}, 'global', 'BUSINESS',
      (SELECT id FROM businesses WHERE company_id=${company} AND name_en='Bulk business' LIMIT 1), '2026-01-01'
    FROM "user" u WHERE u.name='Bulk member' LIMIT 150`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${company}, gen_random_uuid(), u.id, ${CASHIER_ROLE_ID}, 'global', 'BRANCH',
      (SELECT id FROM branches WHERE company_id=${company} AND name_en='Bulk branch' LIMIT 1), '2026-01-01'
    FROM "user" u WHERE u.name='Bulk member' OFFSET 150 LIMIT 150`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${company}, gen_random_uuid(), u.id, ${CASHIER_ROLE_ID}, 'global', 'COMPANY', ${company}, '2026-01-01'
    FROM "user" u WHERE u.name='Bulk member' LIMIT 5`;
}

interface PlanNode {
  readonly 'Node Type'?: string;
  readonly 'Relation Name'?: string;
  readonly 'Index Name'?: string;
  readonly 'Index Cond'?: string;
  readonly 'Rows Removed by Filter'?: number;
  readonly Plans?: readonly PlanNode[];
}

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node['Plans'] ?? []).flatMap(planNodes)];
}

/** الخطة كما يختارها المخطط بنفسه: الفهرس مطلوب لا المسح الشامل. */
async function planOf(statement: SQL): Promise<PlanNode> {
  const rows = await db.withTenant(TENANT.A.company, (tx) =>
    tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`),
  );
  const raw = rows[0]?.['QUERY PLAN'];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const plan = (parsed as { Plan: PlanNode }[] | undefined)?.[0]?.Plan;
  if (plan === undefined) throw new Error('the planner returned no plan');
  return plan;
}

/** الفهرس مطلوب لا المسح؛ disable_seqscan يجعل الخطة تُظهر الفهرس لا الشامل. */
function explain(statement: SQL) {
  return db.withTenant(TENANT.A.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${statement}`);
  });
}
