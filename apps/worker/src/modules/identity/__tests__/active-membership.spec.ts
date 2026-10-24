import { sql, type SQL } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, SYSTEM_ROLES, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { activeMembership, activeMembershipStatement } from '../persistence/active-membership.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
// لحظة ثابتة في وسط السنة: العضوية السارية والعضوية المنتهية يبقى الفرق واضح عندها.
const AT = new Date('2026-06-01T00:00:00.000Z');
// دور الكاشير: العضوية مش محتاجة دور مدير عشان تكون سارية.
const CASHIER_ROLE_ID = SYSTEM_ROLES.find((role) => role.code === 'cashier')?.id ?? '';

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 2, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 2 });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

interface MembershipInput {
  readonly company: string;
  readonly userId: string;
  readonly startsAt: string;
  readonly endsAt: string | null;
}

async function addUser(label: string): Promise<string> {
  const id = ids.newId();
  await owner`INSERT INTO "user"(id,name,email) VALUES(${id},${label},${`${id}@example.test`})`;
  return id;
}

async function addMembership(input: MembershipInput): Promise<void> {
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at,ends_at)
    VALUES(${input.company},${ids.newId()},${input.userId},${CASHIER_ROLE_ID},'global','COMPANY',${input.company},
      ${input.startsAt},${input.endsAt})`;
}

it('a membership counts only inside its window and only in its own company', async () => {
  const open = await addUser('open');
  await addMembership({
    company: TENANT.A.company,
    userId: open,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: null,
  });
  const ending = await addUser('ending');
  await addMembership({
    company: TENANT.A.company,
    userId: ending,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-12-01T00:00:00Z',
  });
  const ended = await addUser('ended');
  await addMembership({
    company: TENANT.A.company,
    userId: ended,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: '2026-05-31T00:00:00Z',
  });
  const later = await addUser('later');
  await addMembership({
    company: TENANT.A.company,
    userId: later,
    startsAt: '2026-07-01T00:00:00Z',
    endsAt: null,
  });
  const foreign = await addUser('foreign');
  await addMembership({
    company: TENANT.B.company,
    userId: foreign,
    startsAt: '2026-01-01T00:00:00Z',
    endsAt: null,
  });
  const inA = (userId: string) =>
    db.withTenant(TENANT.A.company, (tx) => activeMembership(tx, TENANT.A.company, userId, AT));
  expect(await inA(open)).toBe(true);
  expect(await inA(ending)).toBe(true);
  expect(await inA(ended)).toBe(false);
  expect(await inA(later)).toBe(false);
  expect(await inA(foreign)).toBe(false);
  expect(
    await db.withTenant(TENANT.B.company, (tx) =>
      activeMembership(tx, TENANT.B.company, foreign, AT),
    ),
  ).toBe(true);
});

it('the membership probe reads memberships through an index and never a full scan', async () => {
  const bulk = await seedBulkMemberships(TENANT.A.company, 500);
  await owner`ANALYZE memberships`;
  const statement = activeMembershipStatement(TENANT.A.company, bulk, AT);
  for (const plan of [await planOf(statement), await planOf(statement, true)]) {
    const nodes = planNodes(plan);
    expect(
      nodes.some(
        (node) => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'memberships',
      ),
    ).toBe(false);
    const indexes = nodes
      .filter((node) => node['Relation Name'] === 'memberships' && node['Index Name'] !== undefined)
      .map((node) => String(node['Index Name']));
    expect(indexes.length).toBeGreaterThan(0);
    // الفهرس المطلوب company_id+user_id؛ ولو المخطط فضّل فهرس المستخدم لوحده فالمهم إنه مش مسح شامل.
    expect(
      indexes.some(
        (name) =>
          name === 'memberships_company_id_user_id_id_key' || name === 'memberships_user_id_idx',
      ),
    ).toBe(true);
  }
}, 120_000);

/** عضويات كثيرة لنفس الشركة: المخطط لازم يختار فهرس لا مسح شامل. */
async function seedBulkMemberships(company: string, count: number): Promise<string> {
  await owner`INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at)
    SELECT gen_random_uuid(), 'Bulk member', gen_random_uuid()::text||'@example.test', true, now(), now()
    FROM generate_series(1,${count}) AS gs(n)`;
  await owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${company}, gen_random_uuid(), u.id, ${CASHIER_ROLE_ID}, 'global', 'COMPANY', ${company}, '2026-01-01T00:00:00Z'
    FROM "user" u WHERE u.name='Bulk member'`;
  const [row] = await owner`SELECT id FROM "user" WHERE name='Bulk member' LIMIT 1`;
  return String(row?.['id']);
}

interface PlanNode {
  readonly 'Node Type'?: string;
  readonly 'Relation Name'?: string;
  readonly 'Index Name'?: string;
  readonly Plans?: readonly PlanNode[];
}

function planNodes(node: PlanNode): PlanNode[] {
  return [node, ...(node['Plans'] ?? []).flatMap(planNodes)];
}

/** الخطة كما يختارها المخطط: الفهرس مطلوب لا المسح الشامل. */
async function planOf(statement: SQL, force = false): Promise<PlanNode> {
  const rows = await db.withTenant(TENANT.A.company, async (tx) => {
    if (force) await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`);
  });
  const raw = rows[0]?.['QUERY PLAN'];
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const plan = (parsed as { Plan: PlanNode }[] | undefined)?.[0]?.Plan;
  if (plan === undefined) throw new Error('the planner returned no plan');
  return plan;
}
