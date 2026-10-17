import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import {
  applyChange,
  commitChange,
  PERFORMER_STAFF,
  performer,
  recordLine,
  seedPerformerChangeStaff,
  sideSql,
  tenantA,
  type ChangeCtx,
  type Person,
  type Plan,
} from '../../test/service-line-performer-change.ts';

const LINE = {
  base: '01920000-0000-7000-8000-000000004450',
  linked: '01920000-0000-7000-8000-000000004451',
  pair: '01920000-0000-7000-8000-000000004452',
  old: '01920000-0000-7000-8000-000000004453',
  late: '01920000-0000-7000-8000-000000004454',
  race: '01920000-0000-7000-8000-000000004455',
  victim: '01920000-0000-7000-8000-000000004456',
};
let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const ctx: ChangeCtx = tenantA();
const calm = performer(ORDER_IDS.employee, { nameEn: 'Calm' });
const other = performer(PERFORMER_STAFF.emp2, { nameEn: 'Other' });
const third = performer(PERFORMER_STAFF.emp3, { nameEn: 'Third' });
const linked = performer(ORDER_IDS.employee, { nameEn: 'Linked', userId: USER });
const half = (person: Person, ordinal: number): Person => ({ ...person, ordinal, share: 5000 });

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedPerformerChangeStaff(owner, ctx);
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 4 });
  const lines: [string, number, Person[]][] = [
    [LINE.base, 2, [calm]],
    [LINE.linked, 3, [linked]],
    [LINE.pair, 4, [half(calm, 1), half(other, 2)]],
    [LINE.old, 5, [calm]],
    [LINE.late, 6, [calm]],
    [LINE.race, 7, [calm]],
    [LINE.victim, 8, [calm]],
  ];
  for (const [lineId, ordinal, people] of lines)
    await recordLine(db, ctx, ids, lineId, ordinal, people);
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function pgError(error: unknown): { code?: string; constraint_name?: string } {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    const candidate = current as Error & {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (candidate.code !== undefined || candidate.constraint_name !== undefined) return candidate;
    current = candidate.cause;
  }
  return {};
}

async function refused(plan: Plan, constraint: string, code = '23514') {
  const error = await commitChange(db, ctx, ids, plan).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect([pgError(error).code, pgError(error).constraint_name]).toEqual([code, constraint]);
}

const swap = (lineId: string, before: Person[], after = [other]): Plan => ({
  lineId,
  before,
  after,
  live: after,
});

it('refuses a forged linked user on the before side', async () => {
  await refused(
    swap(LINE.linked, [{ ...linked, userId: PERFORMER_STAFF.stranger }]),
    'service_lines_performer_transition',
  );
});

it('refuses a nullified linked user on the before side', async () => {
  await refused(
    swap(LINE.linked, [{ ...linked, userId: null }]),
    'service_lines_performer_transition',
  );
});

it('refuses a before row with a changed share', async () => {
  await refused(swap(LINE.base, [{ ...calm, share: 5000 }]), 'service_lines_performer_transition');
});

it('refuses a before row with a changed ordinal', async () => {
  await refused(swap(LINE.base, [{ ...calm, ordinal: 2 }]), 'service_lines_performer_transition');
});

it('refuses a before row with a changed name', async () => {
  await refused(
    swap(LINE.base, [{ ...calm, nameEn: 'Renamed' }]),
    'service_lines_performer_transition',
  );
});

it('refuses a before row with a changed snapshot flag', async () => {
  await refused(
    swap(LINE.base, [{ ...calm, snapshotted: false }]),
    'service_lines_performer_transition',
  );
});

it('refuses a before row with a changed warning', async () => {
  await refused(swap(LINE.base, [{ ...calm, clock: true }]), 'service_lines_performer_transition');
});

it('refuses a before set that drops a member', async () => {
  await refused(
    swap(LINE.pair, [{ ...calm, share: 10000, ordinal: 1 }]),
    'service_lines_performer_transition',
  );
});

it('refuses a before set that invents a member', async () => {
  await refused(
    swap(LINE.base, [half(calm, 1), half(third, 2)]),
    'service_lines_performer_transition',
  );
});

it('refuses an after set that is not the live set', async () => {
  await refused(
    { lineId: LINE.base, before: [calm], after: [third], live: [other] },
    'slpc_complete',
  );
});

it('refuses to reuse an old change header for a later delete', async () => {
  await commitChange(db, ctx, ids, swap(LINE.old, [calm]));
  await refused(
    {
      lineId: LINE.old,
      before: [],
      after: [],
      live: [],
      skipHeader: true,
      skipBefore: true,
      skipCas: true,
      skipInsert: true,
      skipAfter: true,
    },
    'line_performers_change_guard',
  );
});

it('refuses a late side row inserted into an old header', async () => {
  const changeId = ids.newId();
  await commitChange(db, ctx, ids, { ...swap(LINE.late, [calm]), changeId });
  const error = await db
    .withTenant(
      ctx.company,
      (tx) => tx.execute(sideSql(ctx, ids.newId(), changeId, 'AFTER', third)),
      { userId: ctx.userId },
    )
    .then(
      () => null,
      (caught: unknown) => caught,
    );
  expect((error as { cause?: { constraint_name?: string } }).cause?.constraint_name).toBe(
    'slpcr_current_xact',
  );
});

it('refuses a change that does not bump the revision', async () => {
  await refused(
    { ...swap(LINE.base, [calm]), cas: { revision: 1 } },
    'service_lines_performer_transition',
  );
});

it('refuses a revision bump of two', async () => {
  await refused(
    { ...swap(LINE.base, [calm]), cas: { revision: 3 } },
    'service_lines_performer_transition',
  );
});

it('refuses a revision bump of a different line', async () => {
  await refused(
    {
      ...swap(LINE.base, [calm]),
      cas: { lineId: LINE.victim, revision: 2 },
      skipDelete: true,
      skipInsert: true,
      skipAfter: true,
    },
    'slpc_complete',
  );
});

it('refuses a kept performer whose snapshot was replaced', async () => {
  const replaced = { ...calm, userId: USER };
  await refused(
    { lineId: LINE.base, before: [calm], after: [replaced], live: [replaced] },
    'slpc_complete',
  );
});

it('refuses a new performer that was not snapshotted', async () => {
  const fresh = { ...other, snapshotted: false };
  await refused(
    { lineId: LINE.base, before: [calm], after: [fresh], live: [fresh] },
    'slpc_complete',
  );
});

it('refuses removal of a performer whose snapshot was never taken', async () => {
  const seeded = performer(ORDER_IDS.employee, {
    nameEn: 'Synthetic performer',
    snapshotted: false,
  });
  await refused(
    { lineId: ORDER_IDS.line, before: [seeded], after: [other], live: [other] },
    'slpc_complete',
  );
});

it('refuses an employee from another business of the same company', async () => {
  const error = await db
    .withTenant(
      ctx.company,
      async (tx) => {
        const changeId = await applyChange(tx, ctx, ids, {
          lineId: LINE.base,
          before: [],
          after: [],
          live: [],
          skipBefore: true,
          skipCas: true,
          skipDelete: true,
          skipInsert: true,
          skipAfter: true,
        });
        await tx.execute(
          sideSql(ctx, ids.newId(), changeId, 'BEFORE', performer(PERFORMER_STAFF.otherEmployee)),
        );
      },
      { userId: ctx.userId },
    )
    .then(
      () => null,
      (caught: unknown) => caught,
    );
  const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
  expect([cause?.code, cause?.constraint_name]).toEqual(['23503', 'slpcr_employee_fk']);
});

it('refuses a delete with no change header', async () => {
  await refused(
    {
      lineId: LINE.base,
      before: [],
      after: [],
      live: [],
      skipHeader: true,
      skipBefore: true,
      skipCas: true,
      skipInsert: true,
      skipAfter: true,
    },
    'line_performers_change_guard',
  );
});

it('refuses two performer changes for one line in one transaction', async () => {
  await refused(
    {
      lineId: LINE.base,
      before: [],
      after: [],
      live: [],
      extraHeader: true,
      skipBefore: true,
      skipCas: true,
      skipDelete: true,
      skipInsert: true,
      skipAfter: true,
    },
    'slpc_one_line_per_xact',
  );
});

it('refuses a delete after the change header is rolled back to a savepoint', async () => {
  await refused(
    { lineId: LINE.base, before: [], after: [], live: [], savepoint: true },
    'line_performers_change_guard',
  );
});

it('refuses an incomplete change when constraints are made immediate', async () => {
  await refused({ ...swap(LINE.base, [calm]), immediate: 'before' }, 'slpc_complete');
});

it('refuses a second concurrent change of the same line', async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const plan = swap(LINE.race, [calm]);
  const first = db.withTenant(
    ctx.company,
    (tx) =>
      applyChange(tx, ctx, ids, {
        ...plan,
        afterHeader: async () => {
          release();
          await tx.execute(sql`SELECT pg_sleep(0.4)`);
        },
      }),
    { userId: ctx.userId },
  );
  const second = held.then(() => commitChange(db, ctx, ids, plan));
  const results = await Promise.allSettled([first, second]);
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const rejected = results.find((result) => result.status === 'rejected');
  const cause = (rejected as PromiseRejectedResult | undefined)?.reason as {
    cause?: { constraint_name?: string };
  };
  expect(cause?.cause?.constraint_name).toBe('slpc_begin');
  const rows = await db.withTenant(
    ctx.company,
    (tx) =>
      tx.execute(
        sql`SELECT revision FROM service_line_performer_changes WHERE line_id=${LINE.race}`,
      ),
    { userId: ctx.userId },
  );
  expect(rows).toEqual([{ revision: 2 }]);
});

it('refuses a performer change that also changes the price', async () => {
  await refused(
    { ...swap(LINE.base, [calm]), cas: { touchPrice: true } },
    'service_lines_performer_transition',
  );
});
