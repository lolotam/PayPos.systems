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
  performer,
  recordLine,
  seedPerformerChangeStaff,
  sideSql,
  tenantA,
  type ChangeCtx,
  type Plan,
} from '../../test/service-line-performer-change.ts';

const LINE = '01920000-0000-7000-8000-000000004430';
const VALID = '01920000-0000-7000-8000-000000004431';
let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const ctx: ChangeCtx = tenantA();
const calm = performer(ORDER_IDS.employee);
const next = performer('01920000-0000-7000-8000-000000004410');

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedPerformerChangeStaff(owner, ctx);
  db = createDatabase({ url: testDb.appUrl, ids });
  await recordLine(db, ctx, ids, LINE, 2, [calm]);
  await recordLine(db, ctx, ids, VALID, 3, [calm]);
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

async function rejected(plan: Plan, constraint: string, code = '23514') {
  const error = await commitChange(db, ctx, ids, plan).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
  expect([cause?.code, cause?.constraint_name]).toEqual([code, constraint]);
}

const header = (patch: Partial<Plan>): Plan => ({
  lineId: LINE,
  before: [],
  after: [],
  live: [],
  skipBefore: true,
  skipCas: true,
  skipDelete: true,
  skipInsert: true,
  skipAfter: true,
  ...patch,
});

it('accepts a header and both sides when the set is valid', async () => {
  const changeId = ids.newId();
  await commitChange(db, ctx, ids, {
    lineId: VALID,
    changeId,
    before: [calm],
    after: [next],
    live: [next],
  });
  const [row] = await db.withTenant(
    ctx.company,
    (tx) =>
      tx.execute(
        sql`SELECT count(*)::int AS n FROM service_line_performer_change_rows WHERE change_id=${changeId}`,
      ),
    { userId: ctx.userId },
  );
  expect(row).toEqual({ n: 2 });
});

it('rejects a blank, untrimmed or over-long reason', async () => {
  await rejected(header({ reason: '' }), 'slpc_reason_ck');
  await rejected(header({ reason: '   ' }), 'slpc_reason_ck');
  await rejected(header({ reason: ' x' }), 'slpc_reason_ck');
  await rejected(header({ reason: 'x'.repeat(501) }), 'slpc_reason_ck');
});

it('rejects a revision that is not the next one, and a previous revision below 1', async () => {
  await rejected(header({ revision: 3 }), 'slpc_revision_ck');
  await rejected(header({ previous: 0, revision: 1 }), 'slpc_begin');
  const [check] = await owner`SELECT conname FROM pg_constraint WHERE conname='slpc_revision_ck'`;
  expect(check).toEqual({ conname: 'slpc_revision_ck' });
});

it('rejects a partial role snapshot, a missing identity, a name without its pair, and a long name', async () => {
  await rejected(
    header({ changerRole: 'owner', roleIsSystem: null }),
    'slpc_changer_role_snapshot_ck',
  );
  await rejected(header({ changerNameEn: null }), 'slpc_changer_identity_ck');
  await rejected(
    header({
      changerNameEn: null,
      changerNameAr: 'اسم',
      changerRole: 'owner',
      roleIsSystem: true,
      roleNameEn: 'Owner',
    }),
    'slpc_changer_names_ck',
  );
  await rejected(header({ changerNameEn: 'x'.repeat(256) }), 'slpc_changer_lengths_ck');
});

it('rejects a bad side, a share or ordinal outside the range, and a linked user without a snapshot', async () => {
  await sideRejected('MIDDLE', calm, 'slpcr_side_ck');
  await sideRejected(
    'BEFORE',
    performer(ORDER_IDS.employee, { share: 0 }),
    'slpcr_share_ordinal_ck',
  );
  await sideRejected(
    'BEFORE',
    performer(ORDER_IDS.employee, { ordinal: 5 }),
    'slpcr_share_ordinal_ck',
  );
  await sideRejected(
    'BEFORE',
    performer(ORDER_IDS.employee, { userId: USER, snapshotted: false }),
    'slpcr_snapshot_ck',
  );
});

async function sideRejected(
  side: string,
  person: ReturnType<typeof performer>,
  constraint: string,
) {
  const error = await db
    .withTenant(
      ctx.company,
      async (tx) => {
        const changeId = await applyChange(tx, ctx, ids, header({}));
        await tx.execute(sideSql(ctx, ids.newId(), changeId, side, person));
      },
      { userId: ctx.userId },
    )
    .then(
      () => null,
      (caught: unknown) => caught,
    );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
  expect([cause?.code, cause?.constraint_name]).toEqual(['23514', constraint]);
}
