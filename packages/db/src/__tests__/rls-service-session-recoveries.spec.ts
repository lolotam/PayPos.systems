import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS as ids } from '../../test/orders-fixture.ts';

let testDb: TestDatabase, db: Database, owner: postgres.Sql;
const { A, B } = TENANT;
const PROOF = '01920000-0000-7000-8000-000000004020';
const OTHER = '01920000-0000-7000-8000-000000004015';
const ISSUED = sql`timestamptz '2026-10-15 08:00:00+00'`;
const LATER = sql`timestamptz '2026-10-15 09:00:00+00'`;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await owner`INSERT INTO service_sessions(company_id,id,business_id,branch_id,customer_id,customer_name,customer_phone_masked,
    recorded_by,recorded_by_membership_id,occurred_at,recorded_at,business_date,business_timezone,late)
    VALUES(${A.company},${OTHER},${A.business},${A.branch},${ids.customer},'Synthetic','***123',${USER},${ids.membership},now(),now(),current_date,'Asia/Kuwait',false)`;
  db = createDatabase({ url: testDb.appUrl, ids: { newId: () => PROOF } });
  await asA(sql`INSERT INTO service_session_recoveries(company_id,id,business_id,branch_id,user_id,operation,key_hash,
    business_date,business_timezone,issued_at,last_seen_at,expires_at)
    VALUES(${A.company},${PROOF},${A.business},${A.branch},${USER},'record-service-session','abc',
      '2026-10-15','Asia/Kuwait',${ISSUED},${ISSUED},${ISSUED} + interval '72 hours')`);
});
afterAll(async () => { await db?.close(); await owner?.end(); await testDb?.drop(); });
const STRANGER = '01920000-0000-7000-8000-0000000000f2';
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query), { userId: USER });
const asStranger = (query: ReturnType<typeof sql>) =>
  db.withTenant(A.company, (tx) => tx.execute(query), { userId: STRANGER });
const LINK = '01920000-0000-7000-8000-000000004022';
const RELINK = '01920000-0000-7000-8000-000000004023';
const REVOKE = '01920000-0000-7000-8000-000000004024';
function proofRow(id: string, hash: string) {
  return sql`INSERT INTO service_session_recoveries(company_id,id,business_id,branch_id,user_id,operation,key_hash,
    business_date,business_timezone,issued_at,last_seen_at,expires_at)
    VALUES(${A.company},${id},${A.business},${A.branch},${USER},'record-service-session',${hash},
      '2026-10-15','Asia/Kuwait',${ISSUED},${ISSUED},${ISSUED} + interval '72 hours')`;
}
async function rejected(work: Promise<unknown>, match: RegExp) {
  const error = await work.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  const cause = (error as Error & { cause?: Error }).cause;
  expect(cause?.message ?? (error as Error).message).toMatch(match);
}
describe('service_session_recoveries', () => {
  it('forces tenant RLS with split policies and no app bypass', async () => {
    const [row] = await owner`SELECT c.relrowsecurity,c.relforcerowsecurity,r.rolname FROM pg_class c
      JOIN pg_roles r ON r.oid=c.relowner WHERE c.oid='service_session_recoveries'::regclass`;
    expect(row).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    expect(row?.['rolname']).not.toBe('pospay_app');
    const policies = await owner`SELECT cmd,qual,with_check FROM pg_policies WHERE tablename='service_session_recoveries' ORDER BY cmd`;
    expect(policies.map((policy) => policy['cmd'])).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    for (const policy of policies) {
      const text = `${policy['qual'] ?? ''} ${policy['with_check'] ?? ''}`;
      expect(text).toContain('app_company_id()');
      expect(text).toContain('app_user_id()');
    }
    const [role] = await owner`SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname='pospay_app'`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('returns no cross-tenant rows and refuses a cross-tenant insert', async () => {
    expect(await db.withTenant(B.company, (tx) => tx.execute(sql`SELECT id FROM service_session_recoveries`), { userId: USER })).toEqual([]);
    expect(await asA(sql`SELECT id FROM service_session_recoveries WHERE id=${PROOF}`)).toEqual([{ id: PROOF }]);
    await rejected(asA(sql`INSERT INTO service_session_recoveries(company_id,id,business_id,branch_id,user_id,operation,key_hash,
      business_date,business_timezone,issued_at,last_seen_at,expires_at)
      VALUES(${B.company},'01920000-0000-7000-8000-000000004021',${B.business},${B.branch},${USER},'record-service-session','def',
        '2026-10-15','Asia/Kuwait',${ISSUED},${ISSUED},${ISSUED} + interval '72 hours')`), /row-level security/);
  });
  it('refuses updates outside the column grant and refuses delete', async () => {
    await rejected(asA(sql`UPDATE service_session_recoveries SET key_hash='changed' WHERE id=${PROOF}`), /permission denied/);
    await rejected(asA(sql`UPDATE service_session_recoveries SET business_date='2026-10-01' WHERE id=${PROOF}`), /permission denied/);
    await rejected(asA(sql`DELETE FROM service_session_recoveries WHERE id=${PROOF}`), /permission denied/);
  });
  it('hides a proof from another user of the same company', async () => {
    expect(await asStranger(sql`SELECT id FROM service_session_recoveries WHERE id=${PROOF}`)).toEqual([]);
    await rejected(asStranger(sql`INSERT INTO service_session_recoveries(company_id,id,business_id,branch_id,user_id,operation,key_hash,
      business_date,business_timezone,issued_at,last_seen_at,expires_at)
      VALUES(${A.company},'01920000-0000-7000-8000-000000004025',${A.business},${A.branch},${USER},'record-service-session','other-user',
        '2026-10-15','Asia/Kuwait',${ISSUED},${ISSUED},${ISSUED} + interval '72 hours')`), /row-level security/);
    const [before] = await asA(sql`SELECT last_seen_at FROM service_session_recoveries WHERE id=${PROOF}`);
    expect(await asStranger(sql`UPDATE service_session_recoveries SET last_seen_at=${LATER} WHERE id=${PROOF} RETURNING id`)).toEqual([]);
    expect(await asA(sql`SELECT last_seen_at FROM service_session_recoveries WHERE id=${PROOF}`)).toEqual([before]);
  });
  it('a transaction with no app user sees no proof rows', async () => {
    expect(await db.withTenant(A.company, (tx) => tx.execute(sql`SELECT id FROM service_session_recoveries WHERE id=${PROOF}`))).toEqual([]);
  });
  it('a cross-tenant update matches no row', async () => {
    const [before] = await asA(sql`SELECT last_seen_at FROM service_session_recoveries WHERE id=${PROOF}`);
    expect(await db.withTenant(B.company, (tx) => tx.execute(sql`
      UPDATE service_session_recoveries SET last_seen_at=${LATER} WHERE id=${PROOF} RETURNING id`), { userId: USER })).toEqual([]);
    expect(await asA(sql`SELECT last_seen_at FROM service_session_recoveries WHERE id=${PROOF}`)).toEqual([before]);
  });
  it('links a session from null and keeps an identical link', async () => {
    await asA(proofRow(LINK, 'link'));
    await asA(sql`UPDATE service_session_recoveries SET session_id=${ids.session}, committed_at=${ISSUED} WHERE id=${LINK}`);
    await asA(sql`UPDATE service_session_recoveries SET session_id=${ids.session}, committed_at=${ISSUED} WHERE id=${LINK}`);
    expect(await asA(sql`SELECT session_id FROM service_session_recoveries WHERE id=${LINK}`)).toEqual([{ session_id: ids.session }]);
  });
  it('refuses relinking or rewriting the commit time once set', async () => {
    await asA(proofRow(RELINK, 'relink'));
    await asA(sql`UPDATE service_session_recoveries SET session_id=${ids.session}, committed_at=${ISSUED} WHERE id=${RELINK}`);
    await rejected(asA(sql`UPDATE service_session_recoveries SET session_id=${OTHER} WHERE id=${RELINK}`), /recovery session link is immutable once set/);
    await rejected(asA(sql`UPDATE service_session_recoveries SET committed_at=${LATER} WHERE id=${RELINK}`), /recovery commit time is immutable once set/);
  });
  it('refuses clearing a revoke once set', async () => {
    await asA(proofRow(REVOKE, 'revoke'));
    await asA(sql`UPDATE service_session_recoveries SET revoked_at=${LATER}, revoked_outcome='NOT_RECORDED' WHERE id=${REVOKE}`);
    await rejected(asA(sql`UPDATE service_session_recoveries SET revoked_at=NULL, revoked_outcome=NULL WHERE id=${REVOKE}`), /recovery revoke is immutable once set/);
  });
  it('refuses an expiry past the 168 hour cap', async () => {
    await rejected(asA(sql`UPDATE service_session_recoveries SET expires_at=issued_at + interval '169 hours' WHERE id=${PROOF}`), /recovery expiry exceeds the 168 hour cap/);
  });
});
