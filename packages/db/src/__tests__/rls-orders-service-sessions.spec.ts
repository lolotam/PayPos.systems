import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import {
  backfillServiceSessionRatingRequestDays,
  ServiceSessionRatingRequestDaysRoleRefusedError,
} from '../data-steps/service-session-rating-request-days.ts';
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
const asB = (query: ReturnType<typeof sql>) => db.withTenant(B.company, (tx) => tx.execute(query), { userId: USER });
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
it('PP-286 T-3: pospay_app may set rating_request_day once, respects RLS, and refuses clearing or changing it', async () => {
  expect(
    await asB(sql`UPDATE service_sessions SET rating_request_day = '2026-10-09'::date WHERE company_id = ${A.company} AND id = ${ids.session} RETURNING id`),
  ).toEqual([]);
  await asB(sql`UPDATE service_sessions SET rating_request_day = '2026-10-09'::date WHERE id = ${ids.session}`);
  expect(await asA(sql`SELECT rating_request_day::text AS day FROM service_sessions WHERE id = ${ids.session}`)).toEqual([{ day: null }]);
  await rejected(asA(sql`UPDATE service_sessions SET rating_request_day = NULL WHERE id = ${ids.session}`), /rating_request_day is immutable/);
  await asA(sql`UPDATE service_sessions SET rating_request_day = '2026-10-05'::date WHERE id = ${ids.session}`);
  await asA(sql`UPDATE service_sessions SET rating_request_day = '2026-10-05'::date WHERE id = ${ids.session}`);
  const stored = await asA(sql`SELECT rating_request_day::text AS day FROM service_sessions WHERE id = ${ids.session}`);
  expect(stored[0]?.['day']).toBe('2026-10-05');
  await rejected(asA(sql`UPDATE service_sessions SET rating_request_day = '2026-10-06'::date WHERE id = ${ids.session}`), /rating_request_day is immutable/);
  await rejected(asA(sql`UPDATE service_sessions SET rating_request_day = NULL WHERE id = ${ids.session}`), /rating_request_day is immutable/);
});

async function seedBackfillScenarios(idsByCase: {
  branchA: string; branchB: string; branchC: string;
  customer1: string; customer2: string; customer3: string; customer4: string; customer5: string;
  sOvernightA: string; sLaterB: string; sRemovedHours: string; sNewAfterSent: string; sPreDeployPostSentA: string; sEditedToOvernight: string;
}) {
  const overnightHours = [7, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ opens: '18:00', closes: '02:00' }] }));
  const daytimeHours = [7, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ opens: '10:00', closes: '23:59' }] }));
  await owner.begin(async (tx) => {
    await tx`INSERT INTO branches (company_id, id, business_id, name_en, timezone, opening_hours) VALUES
      (${A.company}, ${idsByCase.branchA}, ${A.business}, 'Branch A Kuwait Overnight', 'Asia/Kuwait', ${tx.json(overnightHours)}),
      (${A.company}, ${idsByCase.branchB}, ${A.business}, 'Branch B West Evening', 'America/New_York', ${tx.json(daytimeHours)}),
      (${A.company}, ${idsByCase.branchC}, ${A.business}, 'Branch C Daytime', 'Asia/Kuwait', ${tx.json(daytimeHours)})`;
    await tx`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at) VALUES
      (${A.company}, ${idsByCase.customer1}, 'Customer 1', '+96550000111', 'en', now(), now()),
      (${A.company}, ${idsByCase.customer2}, 'Customer 2', '+96550000112', 'en', now(), now()),
      (${A.company}, ${idsByCase.customer3}, 'Customer 3', '+96550000113', 'en', now(), now()),
      (${A.company}, ${idsByCase.customer4}, 'Customer 4', '+96550000114', 'en', now(), now()),
      (${A.company}, ${idsByCase.customer5}, 'Customer 5', '+96550000115', 'en', now(), now())`;
    const addSession = (id: string, branchId: string, customerId: string, occurredAt: string) => tx`
      INSERT INTO service_sessions (company_id, id, business_id, branch_id, customer_id, customer_name, customer_phone_masked,
        recorded_by, recorded_by_membership_id, occurred_at, recorded_at, business_date, business_timezone, late)
      VALUES (${A.company}, ${id}, ${A.business}, ${branchId}, ${customerId}, 'Customer', '***111',
        ${USER}, ${ids.membership}, ${occurredAt}::timestamptz, ${occurredAt}::timestamptz, '2026-06-14', 'Asia/Kuwait', false)`;
    await addSession(idsByCase.sOvernightA, idsByCase.branchA, idsByCase.customer1, '2026-06-14T21:30:00Z');
    await addSession(idsByCase.sLaterB, idsByCase.branchB, idsByCase.customer1, '2026-06-14T21:45:00Z');
    await addSession(idsByCase.sRemovedHours, idsByCase.branchC, idsByCase.customer2, '2026-06-14T21:30:00Z');
    await addSession(idsByCase.sNewAfterSent, idsByCase.branchC, idsByCase.customer3, '2026-06-14T21:15:00Z');
    await addSession(idsByCase.sPreDeployPostSentA, idsByCase.branchA, idsByCase.customer4, '2026-06-14T21:15:00Z');
    await addSession(idsByCase.sEditedToOvernight, idsByCase.branchA, idsByCase.customer5, '2026-06-14T21:30:00Z');
    const r3 = '01920000-0000-7000-8000-000000004134';
    const r4 = '01920000-0000-7000-8000-000000004136';
    const r5Prev = '01920000-0000-7000-8000-000000004137';
    const r5Curr = '01920000-0000-7000-8000-000000004138';
    await tx`INSERT INTO rating_requests (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status) VALUES
      (${A.company}, '01920000-0000-7000-8000-000000004131', ${A.business}, ${idsByCase.customer1}, '2026-06-14', ${idsByCase.branchB}, '2026-06-14T22:45:00Z', '2026-06-15T04:29:00Z', 'SCHEDULED'),
      (${A.company}, '01920000-0000-7000-8000-000000004132', ${A.business}, ${idsByCase.customer1}, '2026-06-15', ${idsByCase.branchA}, '2026-06-15T15:00:00Z', '2026-06-15T23:30:00Z', 'SCHEDULED'),
      (${A.company}, '01920000-0000-7000-8000-000000004133', ${A.business}, ${idsByCase.customer2}, '2026-06-14', ${idsByCase.branchC}, '2026-06-14T22:30:00Z', '2026-06-14T23:30:00Z', 'SCHEDULED'),
      (${A.company}, ${r3}, ${A.business}, ${idsByCase.customer3}, '2026-06-14', ${idsByCase.branchC}, '2026-06-14T18:00:00Z', '2026-06-14T23:30:00Z', 'SCHEDULED'),
      (${A.company}, ${r4}, ${A.business}, ${idsByCase.customer4}, '2026-06-14', ${idsByCase.branchA}, '2026-06-14T18:00:00Z', '2026-06-14T23:30:00Z', 'SCHEDULED'),
      (${A.company}, ${r5Prev}, ${A.business}, ${idsByCase.customer5}, '2026-06-14', ${idsByCase.branchA}, '2026-06-14T20:59:00Z', '2026-06-14T21:29:00Z', 'SCHEDULED'),
      (${A.company}, ${r5Curr}, ${A.business}, ${idsByCase.customer5}, '2026-06-15', ${idsByCase.branchA}, '2026-06-14T22:30:00Z', '2026-06-15T21:29:00Z', 'SCHEDULED')`;
    await tx`UPDATE rating_requests SET status = 'SENDING', token_hash = decode(concat(replace(id::text, '-', ''), replace(id::text, '-', '')), 'hex'), token_key_version = 1,
      claimed_at = CASE WHEN id = ${r5Curr} THEN '2026-06-14T22:30:00Z'::timestamptz ELSE '2026-06-14T18:00:00Z'::timestamptz END,
      expires_at = CASE WHEN id = ${r5Curr} THEN '2026-06-21T22:30:00Z'::timestamptz ELSE '2026-06-21T18:00:00Z'::timestamptz END,
      ready_event_id = id
      WHERE company_id = ${A.company} AND id IN (${r3}, ${r4}, ${r5Prev}, ${r5Curr})`;
    await tx`UPDATE rating_requests SET status = 'SENT', sent_at = '2026-06-14T22:31:00Z'
      WHERE company_id = ${A.company} AND id IN (${r3}, ${r4}, ${r5Prev}, ${r5Curr})`;
  });
}

it('PP-286 T-3: backfillServiceSessionRatingRequestDays runs under withTenant, handles multi-branch overnight sessions, and distinguishes active overnight vs post-hours SENT', async () => {
  const idsByCase = {
    branchA: '01920000-0000-7000-8000-000000004101',
    branchB: '01920000-0000-7000-8000-000000004102',
    branchC: '01920000-0000-7000-8000-000000004103',
    customer1: '01920000-0000-7000-8000-000000004111',
    customer2: '01920000-0000-7000-8000-000000004112',
    customer3: '01920000-0000-7000-8000-000000004113',
    customer4: '01920000-0000-7000-8000-000000004114',
    customer5: '01920000-0000-7000-8000-000000004115',
    sOvernightA: '01920000-0000-7000-8000-000000004121',
    sLaterB: '01920000-0000-7000-8000-000000004122',
    sRemovedHours: '01920000-0000-7000-8000-000000004123',
    sNewAfterSent: '01920000-0000-7000-8000-000000004124',
    sPreDeployPostSentA: '01920000-0000-7000-8000-000000004125',
    sEditedToOvernight: '01920000-0000-7000-8000-000000004126',
  };
  await seedBackfillScenarios(idsByCase);
  const nonBypassApp = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  try {
    await expect(backfillServiceSessionRatingRequestDays(nonBypassApp, db)).rejects.toBeInstanceOf(
      ServiceSessionRatingRequestDaysRoleRefusedError,
    );
  } finally {
    await nonBypassApp.end();
  }
  const firstRun = await backfillServiceSessionRatingRequestDays(owner, db);
  expect(firstRun.assigned).toBeGreaterThanOrEqual(5);
  const days = await owner<{ id: string; day: string | null }[]>`
    SELECT id, rating_request_day::text AS day FROM service_sessions
    WHERE company_id = ${A.company} AND id IN (${idsByCase.sOvernightA}, ${idsByCase.sLaterB}, ${idsByCase.sRemovedHours}, ${idsByCase.sNewAfterSent}, ${idsByCase.sPreDeployPostSentA}, ${idsByCase.sEditedToOvernight})
    ORDER BY id`;
  expect(days).toEqual([
    { id: idsByCase.sOvernightA, day: '2026-06-14' },
    { id: idsByCase.sLaterB, day: '2026-06-14' },
    { id: idsByCase.sRemovedHours, day: '2026-06-14' },
    { id: idsByCase.sNewAfterSent, day: null },
    { id: idsByCase.sPreDeployPostSentA, day: '2026-06-14' },
    { id: idsByCase.sEditedToOvernight, day: '2026-06-15' },
  ]);
  const rerun = await backfillServiceSessionRatingRequestDays(owner, db);
  expect(rerun.assigned).toBe(0);
});

it('PP-286 T-3: backfill leaves unscheduled overnight-tail sessions unstamped when prevReq is absent and currReq is SCHEDULED', async () => {
  const branch = '01920000-0000-7000-8000-000000004104';
  const customer6 = '01920000-0000-7000-8000-000000004116';
  const sUnscheduled = '01920000-0000-7000-8000-000000004127';
  const overnightHours = [7, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [{ opens: '18:00', closes: '02:00' }] }));
  await owner.begin(async (tx) => {
    await tx`INSERT INTO branches (company_id, id, business_id, name_en, timezone, opening_hours) VALUES
      (${A.company}, ${branch}, ${A.business}, 'Branch Overnight Unscheduled', 'Asia/Kuwait', ${tx.json(overnightHours)})`;
    await tx`INSERT INTO customers (company_id, id, name, phone, locale, created_at, updated_at) VALUES
      (${A.company}, ${customer6}, 'Customer 6', '+96550000116', 'en', now(), now())`;
    await tx`INSERT INTO service_sessions (company_id, id, business_id, branch_id, customer_id, customer_name, customer_phone_masked,
        recorded_by, recorded_by_membership_id, occurred_at, recorded_at, business_date, business_timezone, late)
      VALUES (${A.company}, ${sUnscheduled}, ${A.business}, ${branch}, ${customer6}, 'Customer', '***116',
        ${USER}, ${ids.membership}, '2026-06-14T21:30:00Z'::timestamptz, '2026-06-14T21:30:00Z'::timestamptz, '2026-06-14', 'Asia/Kuwait', false)`;
    await tx`INSERT INTO rating_requests (company_id, id, business_id, customer_id, business_date, branch_id, due_at, send_deadline, status) VALUES
      (${A.company}, '01920000-0000-7000-8000-000000004139', ${A.business}, ${customer6}, '2026-06-15', ${branch}, '2026-06-15T15:00:00Z', '2026-06-15T23:30:00Z', 'SCHEDULED')`;
  });
  await backfillServiceSessionRatingRequestDays(owner, db);
  const rows = await owner<{ day: string | null }[]>`SELECT rating_request_day::text AS day FROM service_sessions WHERE company_id = ${A.company} AND id = ${sUnscheduled}`;
  expect(rows[0]?.day).toBeNull();
});
