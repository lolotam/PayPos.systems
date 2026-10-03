import { systemUuidV7 } from '@pospay/ids';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { seedTwoTenants, TENANT } from '../../test/tenancy-fixtures.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { createDatabase, type Database, type Tx } from '../index.ts';

const ids = systemUuidV7(),
  { A, B } = TENANT;
let testDb: TestDatabase, db: Database, owner: postgres.Sql;
beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});
async function employee() {
  const id = ids.newId();
  await owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,role_code,hire_date) VALUES (${A.company},${id},${A.business},${A.branch},'Synthetic history','staff','2026-01-01')`;
  return id;
}
function insert(tx: Tx, employeeId: string, from: string, to: string | null) {
  return tx.execute(
    sql`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from","to") VALUES (${A.company},${ids.newId()},${A.business},${employeeId},${A.branch},${from},${to})`,
  );
}
const asA = (query: ReturnType<typeof sql>) => db.withTenant(A.company, (tx) => tx.execute(query));
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Synthetic barrier uninitialized');
  };
  let reject: (reason: unknown) => void = () => {
    throw new Error('Synthetic barrier uninitialized');
  };
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it('pospay_app rejects overlap with closed history and allows adjacent intervals', async () => {
  const id = await employee();
  await db.withTenant(A.company, (tx) => insert(tx, id, '2026-10-01', '2026-10-15'));
  await expect(
    db.withTenant(A.company, (tx) => insert(tx, id, '2026-10-10', null)),
  ).rejects.toMatchObject({
    cause: { code: '23P01', constraint_name: 'employee_branches_no_overlap' },
  });
  await db.withTenant(A.company, (tx) => insert(tx, id, '2026-09-01', '2026-10-01'));
  await db.withTenant(A.company, (tx) => insert(tx, id, '2026-10-15', null));
  expect(await owner`SELECT id FROM employee_branches WHERE employee_id=${id}`).toHaveLength(3);
});
it('concurrent closed inserts cannot overlap even without API locks or the open-only unique index', async () => {
  const id = await employee();
  // الصفان مغلقان؛ الحماية هنا من GiST وحده وليست من فهرس الصف المفتوح.
  const inserted = deferred<undefined>();
  const release = deferred<undefined>();
  const started = deferred<number>();
  const first = db.withTenant(A.company, async (tx) => {
    await insert(tx, id, '2026-10-10', '2026-10-20');
    inserted.resolve(undefined);
    await release.promise;
  });
  void first.catch(inserted.reject);
  await inserted.promise;
  const second = db.withTenant(A.company, async (tx) => {
    const [backend] = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
    if (backend === undefined) throw new Error('Synthetic backend missing');
    started.resolve(backend.pid);
    await insert(tx, id, '2026-10-15', '2026-10-25');
  });
  void second.catch(started.reject);
  const settled = Promise.allSettled([first, second]);
  try {
    const pid = await started.promise;
    await expect
      .poll(async () => {
        const [backend] =
          await owner`SELECT wait_event_type FROM pg_stat_activity WHERE pid=${pid}`;
        return backend?.['wait_event_type'];
      })
      .toBe('Lock');
  } finally {
    release.resolve(undefined);
    await settled;
  }
  const results = await settled;
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const refused = results.find((result) => result.status === 'rejected');
  expect(refused?.status === 'rejected' ? refused.reason : null).toMatchObject({
    cause: { code: '23P01', constraint_name: 'employee_branches_no_overlap' },
  });
  expect(await owner`SELECT id FROM employee_branches WHERE employee_id=${id}`).toHaveLength(1);
});
it('pospay_app can close once but cannot extend, shorten, reopen or rewrite a closed interval', async () => {
  const id = await employee();
  await db.withTenant(A.company, (tx) => insert(tx, id, '2026-10-01', null));
  await asA(sql`UPDATE employee_branches SET "to"='2026-10-15' WHERE employee_id=${id}`);
  for (const end of ['2026-10-20', '2026-10-10', '2026-10-15', null]) {
    await expect(
      asA(sql`UPDATE employee_branches SET "to"=${end} WHERE employee_id=${id}`),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'employee_branches_close_once' },
    });
  }
  expect(
    await owner`SELECT "from"::text,"to"::text FROM employee_branches WHERE employee_id=${id}`,
  ).toEqual([{ from: '2026-10-01', to: '2026-10-15' }]);
});
it.each(['2026-09-30', '2026-10-01'])(
  'pospay_app cannot close or insert a non-positive interval ending %s',
  async (end) => {
    const id = await employee();
    await db.withTenant(A.company, (tx) => insert(tx, id, '2026-10-01', null));
    await expect(
      asA(sql`UPDATE employee_branches SET "to"=${end} WHERE employee_id=${id}`),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'employee_branches_nonempty_interval' },
    });
    const other = await employee();
    await expect(
      db.withTenant(A.company, (tx) => insert(tx, other, '2026-10-01', end)),
    ).rejects.toMatchObject({
      cause: { code: '23514', constraint_name: 'employee_branches_nonempty_interval' },
    });
  },
);
it('tenant isolation prevents another company from closing an open interval', async () => {
  const id = await employee();
  await db.withTenant(A.company, (tx) => insert(tx, id, '2026-10-01', null));
  expect(
    await db.withTenant(B.company, (tx) =>
      tx.execute(
        sql`UPDATE employee_branches SET "to"='2026-10-15' WHERE employee_id=${id} RETURNING id`,
      ),
    ),
  ).toHaveLength(0);
  expect(await owner`SELECT "to" FROM employee_branches WHERE employee_id=${id}`).toEqual([
    { to: null },
  ]);
  await expect(
    asA(sql`UPDATE employee_branches SET "to"=NULL WHERE employee_id=${id}`),
  ).rejects.toMatchObject({ cause: { constraint_name: 'employee_branches_close_once' } });
});
