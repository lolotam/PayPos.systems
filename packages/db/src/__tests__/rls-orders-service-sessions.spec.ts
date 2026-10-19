import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS as ids } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, db: Database, owner: postgres.Sql;
const { A, B } = TENANT;
const tables = ['service_sessions','service_lines','line_performers'] as const;
const fresh = '01920000-0000-7000-8000-000000004099';
const otherBusiness = '01920000-0000-7000-8000-000000004098';
const otherEmployee = '01920000-0000-7000-8000-000000004097';
beforeAll(async () => {
  testDb = await createTestDatabase(); await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await owner`INSERT INTO businesses(company_id,id,name_en,vertical_type) VALUES(${A.company},${otherBusiness},'Synthetic second business','salon')`;
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date,employee_number)
    VALUES(${A.company},${otherEmployee},${A.business},${A.branch},'Synthetic second employee','synthetic second employee','staff','2026-01-01',2)`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => fresh } });
});
afterAll(async () => { await db?.close(); await owner?.end(); await testDb?.drop(); });
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query), { userId: USER });
function insert(table: typeof tables[number], company: string, business: string, parent = ids.session, employee = ids.employee, share = 1, warning = false) {
  if (table === 'service_sessions') return sql`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late)
    VALUES(${company},${fresh},${business},${A.branch},${ids.customer},'Synthetic','***123',${USER},${ids.membership},now(),now(),current_date,'Asia/Kuwait',false)`;
  if (table === 'service_lines') return sql`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,list_price,price,discount,net,
    effective_discount_bps,limit_source,limit_bps_applied,name_en,catalog_revision,rule_kind,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
    VALUES(${company},${fresh},${business},${parent},${ids.service},2,0,'ACTIVE',1,1.000,1.000,0.000,1.000,0,'OWNER',NULL,'Synthetic',1,'ZERO',true,false,${USER},${ids.membership},now(),false)`;
  return sql`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,not_clocked_in_warning,approved_leave_warning)
    VALUES(${company},${fresh},${business},${parent},${employee},2,${share},'Synthetic',${warning},false)`;
}
async function rejected(work: Promise<unknown>, match: RegExp) {
  const error = await work.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: Error }).cause;
  expect(cause?.message ?? (error as Error).message).toMatch(match);
}
describe.each(tables)('%s forced isolation and insert-only privileges', (table) => {
  it('FORCE RLS and both policy predicates; runtime owns no table and has no bypass', async () => {
    const [row] = await owner`SELECT c.relrowsecurity,c.relforcerowsecurity,r.rolname FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid=${table}::regclass`;
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true }); expect(row?.['rolname']).not.toBe('pospay_app');
    const [policy] = await owner`SELECT qual,with_check FROM pg_policies WHERE tablename=${table}`;
    expect(policy?.['qual']).toContain('app_company_id()'); expect(policy?.['with_check']).toContain('app_company_id()');
    const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('same ID in two companies is isolated; cross-company insert and foreign-business parents fail', async () => {
    expect(await asA(sql`SELECT company_id,id FROM ${sql.identifier(table)}`)).toEqual([{ company_id: A.company, id: table === 'service_sessions' ? ids.session : table === 'service_lines' ? ids.line : ids.performer }]);
    await rejected(asA(insert(table, B.company, B.business)), /row-level security/);
    await rejected(asA(insert(table, A.company, B.business, table === 'line_performers' ? fresh : ids.session)), /foreign key/);
  });
  it('UPDATE/DELETE/TRUNCATE are refused by actual runtime grants', async () => {
    await rejected(asA(sql`UPDATE ${sql.identifier(table)} SET business_id=${B.business}`), /permission denied/);
    await rejected(asA(sql`DELETE FROM ${sql.identifier(table)}`), table === 'line_performers' ? /change header/ : /permission denied/);
    await rejected(asA(sql`TRUNCATE ${sql.identifier(table)}`), /permission denied/);
  });
  it('same-company parents in another business are refused by the qualified FK', async () => {
    await rejected(asA(insert(table, A.company, otherBusiness, table === 'line_performers' ? ids.line : ids.session, otherEmployee)), /foreign key/);
  });
});
it('no context, pool reuse, rollback and concurrent tenant transactions never leak', async () => {
  const app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try { for (const table of tables) expect(await app.unsafe(`SELECT id FROM ${table}`)).toEqual([]); } finally { await app.end(); }
  await expect(db.withTenant(B.company, async (tx) => { await tx.execute(sql`SELECT id FROM service_sessions`); throw new Error('rollback'); })).rejects.toThrow('rollback');
  const results = await Promise.all([A.company,B.company,A.company].map((company) => db.withTenant(company, (tx) => tx.execute(sql`SELECT company_id FROM service_sessions`))));
  expect(results.map((r) => r[0]?.company_id)).toEqual([A.company,B.company,A.company]);
});
it('deferred invoker trigger rejects a line with no performers, wrong sum, or warning mismatch at commit', async () => {
  await rejected(asA(insert('service_lines', A.company, A.business)), /Invalid performer set/);
  await rejected(db.withTenant(A.company, async (tx) => {
    await tx.execute(insert('service_lines', A.company, A.business));
    await tx.execute(insert('line_performers', A.company, A.business, fresh));
  }), /Invalid performer set/);
  await rejected(db.withTenant(A.company, async (tx) => {
    await tx.execute(insert('service_lines', A.company, A.business));
    await tx.execute(insert('line_performers', A.company, A.business, fresh, ids.employee, 10000, true));
  }), /Invalid performer set/);
  const functions = await owner`SELECT proname,prosecdef FROM pg_proc WHERE proname IN ('orders_check_performers','orders_performer_consistency')`;
  expect(functions).toHaveLength(2); expect(functions.every((r) => r['prosecdef'] === false)).toBe(true);
});
