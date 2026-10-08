import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { seedTwoTenants, TENANT, USER } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database } from '../index.ts';

const { A, B } = TENANT;
const ids = systemUuidV7();
const employee = ids.newId(),
  session = ids.newId(),
  correction = ids.newId();
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
  await owner`INSERT INTO "user"(id,name,email) VALUES(${USER},'Synthetic corrector','corrector@example.test') ON CONFLICT DO NOTHING`;
  for (const t of [A, B]) {
    await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date)
      VALUES(${t.company},${employee},${t.business},${t.branch},'Synthetic staff','staff','2026-01-01')`;
    await owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,clock_out,status,source,closed_by,geo,late_minutes)
      VALUES(${t.company},${session},${t.business},${t.branch},${employee},'2026-10-04','Asia/Kuwait','2026-10-04T05:00:00Z','2026-10-04T08:00:00Z','CLOSED','QR','EMPLOYEE','NONE',0)`;
  }
  await db.withTenant(B.company, (tx) => tx.execute(insert(B)));
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function insert(t: { company: string; business: string; branch: string }, sessionId = session) {
  return sql`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
    VALUES(${t.company},${correction},${t.business},${t.branch},${employee},${sessionId},${ids.newId()},'CLOCK_OUT','2026-10-04T08:00:00Z','2026-10-04T09:00:00Z','Synthetic correction',${USER},'2026-10-04T10:00:00Z') RETURNING id`;
}
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));

it('forces RLS, hides B from A and hides every tenant outside withTenant', async () => {
  const [flags] =
    await owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='attendance_corrections'`;
  expect(flags).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  expect(await asA(sql`SELECT id FROM attendance_corrections`)).toHaveLength(0);
  expect(
    await db.withUser(USER, (tx) => tx.execute(sql`SELECT id FROM attendance_corrections`)),
  ).toHaveLength(0);
  await expect(asA(insert(B))).rejects.toThrow();
});

it('rejects foreign tenant/business parents and supports equal ids in different tenants', async () => {
  const foreign = ids.newId();
  await owner`INSERT INTO attendance_sessions(company_id,id,business_id,branch_id,employee_id,working_date,timezone,clock_in,status,source,geo,late_minutes)
    VALUES(${B.company},${foreign},${B.business},${B.branch},${employee},'2026-10-05','Asia/Kuwait','2026-10-05T05:00:00Z','OPEN','QR','NONE',0)`;
  await expect(asA(insert(A, foreign))).rejects.toThrow();
  await expect(asA(insert({ ...A, business: B.business }))).rejects.toThrow();
  await expect(asA(insert({ ...A, branch: B.branch }))).rejects.toThrow();
  expect(await asA(insert(A))).toHaveLength(1);
  expect(await owner`SELECT id FROM attendance_corrections WHERE id=${correction}`).toHaveLength(2);
});

it('denies updates, deletes, tenant-key rewrites and upserts even for the same tenant', async () => {
  for (const company of [A.company, B.company]) {
    await expect(
      asA(sql`UPDATE attendance_corrections SET reason='tampered' WHERE company_id=${company}`),
    ).rejects.toThrow();
    await expect(
      asA(sql`DELETE FROM attendance_corrections WHERE company_id=${company}`),
    ).rejects.toThrow();
  }
  await expect(
    asA(sql`UPDATE attendance_corrections SET company_id=${B.company}`),
  ).rejects.toThrow();
  await expect(
    asA(
      sql`INSERT INTO attendance_corrections SELECT * FROM attendance_corrections ON CONFLICT(company_id,id) DO UPDATE SET reason='tampered'`,
    ),
  ).rejects.toThrow();
  expect(await owner`SELECT reason FROM attendance_corrections`).toEqual([
    { reason: 'Synthetic correction' },
    { reason: 'Synthetic correction' },
  ]);
});

it.each(['authUrl', 'dispatcherUrl', 'notificationsUrl'] as const)(
  '%s has no correction privileges',
  async (url) => {
    const role = postgres(testDb[url], { max: 1, onnotice: () => undefined });
    try {
      await expect(role`SELECT id FROM attendance_corrections`).rejects.toThrow(
        /permission denied/,
      );
      await expect(role`DELETE FROM attendance_corrections`).rejects.toThrow(/permission denied/);
    } finally {
      await role.end();
    }
  },
);

it('migration grants only the four manager defaults and refuses malformed correction records', async () => {
  const defaults = await owner`SELECT r.code FROM role_permissions p JOIN roles r ON r.id=p.role_id
    WHERE p.permission_code='correct:attendance:branch' AND r.company_id IS NULL ORDER BY r.code`;
  expect(defaults.map((row) => row['code'])).toEqual([
    'branch_manager',
    'business_manager',
    'general_manager',
    'owner',
  ]);
  for (const [field, reason, after] of [
    ['VOID', 'reason', '2026-10-04T09:00:00Z'],
    ['CLOCK_IN', ' ', '2026-10-04T09:00:00Z'],
    ['CLOCK_OUT', 'reason', '2026-10-04T08:00:00Z'],
  ]) {
    await expect(owner`INSERT INTO attendance_corrections(company_id,id,business_id,branch_id,employee_id,session_id,request_id,field,before_at,after_at,reason,corrected_by,corrected_at)
      VALUES(${A.company},${ids.newId()},${A.business},${A.branch},${employee},${session},${ids.newId()},${field as string},'2026-10-04T08:00:00Z',${after as string},${reason as string},${USER},now())`).rejects.toThrow();
  }
  await expect(
    owner`UPDATE attendance_sessions SET revision=-1 WHERE company_id=${A.company}`,
  ).rejects.toThrow();
});
