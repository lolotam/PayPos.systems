import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS as ids } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, db: Database, owner: postgres.Sql;
const { A, B } = TENANT;
const NEW = {
  line: '01920000-0000-7000-8000-000000004201',
  performer: '01920000-0000-7000-8000-000000004202',
  employee: '01920000-0000-7000-8000-000000004203',
  stranger: '01920000-0000-7000-8000-000000004204',
};
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${A.company},${NEW.employee},${A.business},${A.branch},'Synthetic linked employee','synthetic linked employee','staff','2026-01-01')`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => NEW.performer } });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
const as = (company: string, query: ReturnType<typeof sql>) => db.withTenant(company, (tx) => tx.execute(query), { userId: USER });

function performer(linkedUser: string | null, snapshotted: boolean | undefined, employee = NEW.employee) {
  const columns = snapshotted === undefined ? sql`` : sql`,linked_user_id,linked_user_snapshotted`;
  const values = snapshotted === undefined ? sql`` : sql`,${linkedUser},${snapshotted}`;
  return sql`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,
    not_clocked_in_warning,approved_leave_warning${columns}) VALUES(${A.company},${NEW.performer},${A.business},${ids.line},${employee},2,1,'Synthetic',false,false${values})`;
}
async function rejected(work: Promise<unknown>, code: string, constraint: string) {
  const error = await work.then(() => null, (caught: unknown) => caught);
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: { code?: string; constraint_name?: string } }).cause;
  expect([cause?.code, cause?.constraint_name]).toEqual([code, constraint]);
}

it('reads false and null for a performer written without the new columns, as an old instance does', async () => {
  expect(await as(A.company, sql`SELECT linked_user_id,linked_user_snapshotted FROM line_performers WHERE id=${ids.performer}`)).toEqual([
    { linked_user_id: null, linked_user_snapshotted: false },
  ]);
});

it('refuses a linked user without the snapshot flag, and a user that does not exist', async () => {
  await rejected(as(A.company, performer(USER, false)), '23514', 'line_performers_linked_user_snapshot');
  await rejected(as(A.company, performer(NEW.stranger, true)), '23503', 'line_performers_linked_user_id_user_id_fk');
});

it('stores an unlinked snapshot and a linked snapshot on a new line', async () => {
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,list_price,price,discount,net,
      effective_discount_bps,limit_source,limit_bps_applied,name_en,catalog_revision,rule_kind,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      VALUES(${A.company},${NEW.line},${A.business},${ids.session},${ids.service},2,1,'ACTIVE',1,1.000,1.000,0.000,1.000,0,'OWNER',NULL,'Synthetic',1,'ZERO',true,false,${USER},${ids.membership},now(),false)`);
    await tx.execute(sql`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,
      not_clocked_in_warning,approved_leave_warning,linked_user_id,linked_user_snapshotted)
      VALUES(${A.company},${NEW.performer},${A.business},${NEW.line},${NEW.employee},1,10000,'Synthetic',false,false,${USER},true)`);
  }, { userId: USER });
  expect(await as(A.company, sql`SELECT linked_user_id,linked_user_snapshotted FROM line_performers WHERE id=${NEW.performer}`)).toEqual([
    { linked_user_id: USER, linked_user_snapshotted: true },
  ]);
  await db.withTenant(A.company, async (tx) => {
    await tx.execute(sql`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,list_price,price,discount,net,
      effective_discount_bps,limit_source,limit_bps_applied,name_en,catalog_revision,rule_kind,counts_toward_threshold,has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
      VALUES(${A.company},${NEW.stranger},${A.business},${ids.session},${ids.service},3,2,'ACTIVE',1,1.000,1.000,0.000,1.000,0,'OWNER',NULL,'Synthetic',1,'ZERO',true,false,${USER},${ids.membership},now(),false)`);
    await tx.execute(sql`INSERT INTO line_performers(company_id,id,business_id,line_id,employee_id,performer_ordinal,share_bps,name_en,
      not_clocked_in_warning,approved_leave_warning,linked_user_id,linked_user_snapshotted)
      VALUES(${A.company},${NEW.stranger},${A.business},${NEW.stranger},${NEW.employee},1,10000,'Synthetic',false,false,NULL,true)`);
  }, { userId: USER });
  expect(await as(A.company, sql`SELECT linked_user_id,linked_user_snapshotted FROM line_performers WHERE id=${NEW.stranger}`)).toEqual([
    { linked_user_id: null, linked_user_snapshotted: true },
  ]);
});

it('hides the snapshot columns from the other company', async () => {
  const query = sql`SELECT linked_user_id,linked_user_snapshotted FROM line_performers WHERE company_id=${A.company}`;
  expect(await as(B.company, query)).toEqual([]);
  expect(await as(B.company, sql`SELECT linked_user_id FROM line_performers WHERE linked_user_id=${USER}`)).toEqual([]);
  expect((await as(A.company, query)).length).toBeGreaterThan(0);
});

it('keeps the snapshot immutable: no UPDATE grant on the table or its columns, DELETE refused', async () => {
  for (const statement of [
    sql`UPDATE line_performers SET linked_user_id=NULL`,
    sql`UPDATE line_performers SET linked_user_snapshotted=true`,
    sql`DELETE FROM line_performers`,
  ]) {
    const error = await as(A.company, statement).then(() => null, (caught: unknown) => caught);
    expect((error as Error & { cause?: Error }).cause?.message).toMatch(/permission denied/);
  }
  const [grants] = await owner`SELECT
    has_table_privilege('pospay_app','line_performers','SELECT') AS can_select,
    has_table_privilege('pospay_app','line_performers','INSERT') AS can_insert,
    has_any_column_privilege('pospay_app','line_performers','UPDATE') AS can_update_any_column,
    has_table_privilege('pospay_app','line_performers','DELETE') AS can_delete`;
  expect(grants).toEqual({ can_select: true, can_insert: true, can_update_any_column: false, can_delete: false });
});

it('indexes the linked user for the foreign key, partially', async () => {
  const [index] = await owner`SELECT indexdef FROM pg_indexes WHERE indexname='line_performers_linked_user_idx'`;
  expect(index?.['indexdef']).toContain('WHERE (linked_user_id IS NOT NULL)');
});
