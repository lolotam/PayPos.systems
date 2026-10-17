import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import {
  applyChange,
  commitChange,
  PERFORMER_STAFF,
  performer,
  recordLine,
  seedPerformerChangeStaff,
  tenantA,
  type ChangeCtx,
  type Person,
  type Plan,
} from '../../test/service-line-performer-change.ts';

const LINE = {
  replace: '01920000-0000-7000-8000-000000004440',
  keep: '01920000-0000-7000-8000-000000004441',
  add: '01920000-0000-7000-8000-000000004442',
  remove: '01920000-0000-7000-8000-000000004443',
  up: '01920000-0000-7000-8000-000000004444',
  down: '01920000-0000-7000-8000-000000004445',
  seq: '01920000-0000-7000-8000-000000004446',
  price: '01920000-0000-7000-8000-000000004447',
  xid: '01920000-0000-7000-8000-000000004448',
  immediate: '01920000-0000-7000-8000-000000004449',
};
let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const ctx: ChangeCtx = tenantA();
const first = performer(ORDER_IDS.employee, { nameEn: 'First' });
const second = performer(PERFORMER_STAFF.emp2, { nameEn: 'Second' });
const third = performer(PERFORMER_STAFF.emp3, { nameEn: 'Third' });
const half = (person: Person, ordinal: number): Person => ({ ...person, ordinal, share: 5000 });

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedPerformerChangeStaff(owner, ctx);
  db = createDatabase({ url: testDb.appUrl, ids });
  const lines: [string, number, Person[]][] = [
    [LINE.replace, 2, [first]],
    [LINE.keep, 3, [half(first, 1), half(second, 2)]],
    [LINE.add, 4, [first]],
    [LINE.remove, 5, [half(first, 1), half(second, 2)]],
    [LINE.up, 6, [first]],
    [LINE.down, 7, [{ ...first, clock: true }]],
    [LINE.seq, 8, [first]],
    [LINE.price, 9, [first]],
    [LINE.xid, 10, [first]],
    [LINE.immediate, 11, [first]],
  ];
  for (const [lineId, ordinal, people] of lines)
    await recordLine(db, ctx, ids, lineId, ordinal, people);
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

const read = (lineId: string) =>
  db.withTenant(
    ctx.company,
    (tx) =>
      tx.execute(sql`SELECT employee_id, has_performer_warning AS warning FROM line_performers p
      JOIN service_lines l ON l.company_id=p.company_id AND l.id=p.line_id
      WHERE p.line_id=${lineId} ORDER BY performer_ordinal`),
    { userId: ctx.userId },
  );

async function changed(plan: Plan, employees: string[], warning: boolean) {
  await commitChange(db, ctx, ids, plan);
  expect(await read(plan.lineId)).toEqual(
    employees.map((employee_id) => ({ employee_id, warning })),
  );
}

it('replaces every performer', async () => {
  await changed(
    { lineId: LINE.replace, before: [first], after: [second], live: [second] },
    [PERFORMER_STAFF.emp2],
    false,
  );
});

it('keeps one performer and replaces the other', async () => {
  const kept = half(first, 1);
  const added = half(third, 2);
  await changed(
    {
      lineId: LINE.keep,
      before: [half(first, 1), half(second, 2)],
      after: [kept, added],
      live: [kept, added],
    },
    [ORDER_IDS.employee, PERFORMER_STAFF.emp3],
    false,
  );
});

it('adds one performer', async () => {
  const kept = half(first, 1);
  const added = half(second, 2);
  await changed(
    { lineId: LINE.add, before: [first], after: [kept, added], live: [kept, added] },
    [ORDER_IDS.employee, PERFORMER_STAFF.emp2],
    false,
  );
});

it('removes one performer', async () => {
  const kept = { ...first, share: 10000, ordinal: 1 };
  await changed(
    { lineId: LINE.remove, before: [half(first, 1), half(second, 2)], after: [kept], live: [kept] },
    [ORDER_IDS.employee],
    false,
  );
});

it('raises and lowers the performer warning with the set', async () => {
  const warned = { ...first, clock: true };
  await changed(
    { lineId: LINE.up, before: [first], after: [warned], live: [warned], warning: true },
    [ORDER_IDS.employee],
    true,
  );
  const calm = { ...first, clock: false };
  await changed(
    {
      lineId: LINE.down,
      before: [{ ...first, clock: true }],
      after: [calm],
      live: [calm],
      warning: false,
    },
    [ORDER_IDS.employee],
    false,
  );
});

it('accepts a later change after a price revision and after another performer change', async () => {
  await db.withTenant(
    ctx.company,
    (tx) =>
      tx.execute(
        sql`UPDATE service_lines SET price=price+1, net=net+1, revision=revision+1 WHERE id=${LINE.price}`,
      ),
    { userId: ctx.userId },
  );
  await changed(
    {
      lineId: LINE.price,
      previous: 2,
      revision: 3,
      before: [first],
      after: [second],
      live: [second],
    },
    [PERFORMER_STAFF.emp2],
    false,
  );
  await changed(
    { lineId: LINE.seq, before: [first], after: [second], live: [second] },
    [PERFORMER_STAFF.emp2],
    false,
  );
  await changed(
    { lineId: LINE.seq, previous: 2, revision: 3, before: [second], after: [first], live: [first] },
    [ORDER_IDS.employee],
    false,
  );
});

it('overwrites a client write_xid and still commits when constraints are forced', async () => {
  const changeId = ids.newId();
  const [row] = await db.withTenant(
    ctx.company,
    async (tx) => {
      await applyChange(tx, ctx, ids, {
        lineId: LINE.xid,
        changeId,
        writeXid: '999999',
        before: [first],
        after: [second],
        live: [second],
      });
      return tx.execute(sql`SELECT write_xid::text AS xid, pg_current_xact_id()::text AS current
        FROM service_line_performer_changes WHERE id=${changeId}`);
    },
    { userId: ctx.userId },
  );
  expect(row?.['xid']).toBe(row?.['current']);
  expect(row?.['xid']).not.toBe('999999');
  await commitChange(db, ctx, ids, {
    lineId: LINE.immediate,
    before: [first],
    after: [second],
    live: [second],
    immediate: 'done',
  });
  expect(await read(LINE.immediate)).toEqual([
    { employee_id: PERFORMER_STAFF.emp2, warning: false },
  ]);
});
