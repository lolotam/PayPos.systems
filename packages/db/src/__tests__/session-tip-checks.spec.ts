import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database } from '../index.ts';
import type { Tx } from '../with-tenant.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { seedOrders } from '../../test/orders-fixture.ts';
import {
  openSession,
  revisionRow,
  revisionSql,
  seedSessionTipStaff,
  tenantA,
  tipRow,
  tipSql,
  writeRevision,
  type TipCtx,
} from '../../test/session-tip.ts';

let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const ctx: TipCtx = tenantA();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedSessionTipStaff(owner);
  db = createDatabase({ url: testDb.appUrl, ids });
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

async function rejected(work: Promise<unknown>, code: string, constraint: string) {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
  expect([cause?.code, cause?.constraint_name]).toEqual([code, constraint]);
}

async function session(): Promise<string> {
  const sessionId = ids.newId();
  await openSession(owner, ctx, sessionId);
  return sessionId;
}

const inTenant = <T>(work: (tx: Tx) => Promise<T>) =>
  db.withTenant(ctx.company, work, { userId: ctx.userId });

it('accepts revision 1 with a null previous revision', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  const [row] = await inTenant((tx) =>
    tx.execute(
      sql`SELECT revision, previous_revision FROM session_tip_revisions WHERE session_id=${sessionId}`,
    ),
  );
  expect(row).toEqual({ revision: 1, previous_revision: null });
});

it('accepts revision 2 after revision 1 when a reason is stored', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 2));
  const rows = await inTenant((tx) =>
    tx.execute(
      sql`SELECT revision FROM session_tip_revisions WHERE session_id=${sessionId} ORDER BY revision`,
    ),
  );
  expect(rows).toEqual([{ revision: 1 }, { revision: 2 }]);
});

it('refuses revision 2 without a reason', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, sessionId, 2, { reason: null })),
    '23514',
    'session_tip_revisions_reason_required_ck',
  );
});

it('tolerates a reason on revision 1', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1, { reason: 'Opening note' }));
  const [row] = await inTenant((tx) =>
    tx.execute(sql`SELECT reason FROM session_tip_revisions WHERE session_id=${sessionId}`),
  );
  expect(row).toEqual({ reason: 'Opening note' });
});

it('refuses revision 3 when only revision 1 exists', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, sessionId, 3, { previous: 2 })),
    '23503',
    'session_tip_revisions_previous_fk',
  );
});

it('refuses a first revision that is not 1', async () => {
  const sessionId = await session();
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, sessionId, 5, { previous: null })),
    '23514',
    'session_tip_revisions_revision_ck',
  );
});

it('refuses two revisions with the same number', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, sessionId, 1)),
    '23505',
    'session_tip_revisions_session_revision_uq',
  );
});

it('refuses a second revision for one session in one transaction', async () => {
  const sessionId = await session();
  await rejected(
    inTenant(async (tx) => {
      await tx.execute(revisionSql(ctx, revisionRow(ids, sessionId, 1)));
      await tx.execute(revisionSql(ctx, revisionRow(ids, sessionId, 2)));
    }),
    '23505',
    'session_tip_revisions_session_xid_uq',
  );
});

it('refuses a duplicate event id', async () => {
  const eventId = ids.newId();
  const first = await session();
  const second = await session();
  await writeRevision(db, ctx, revisionRow(ids, first, 1, { eventId }));
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, second, 1, { eventId })),
    '23505',
    'session_tip_revisions_event_uq',
  );
});

it('refuses a padded reason', async () => {
  const sessionId = await session();
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, sessionId, 1, { reason: ' padded ' })),
    '23514',
    'session_tip_revisions_reason_ck',
  );
});

it('refuses a tab-only reason', async () => {
  const sessionId = await session();
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, sessionId, 1, { reason: '\t' })),
    '23514',
    'session_tip_revisions_reason_ck',
  );
});

it('refuses a 501-character reason', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, sessionId, 2, { reason: 'x'.repeat(501) })),
    '23514',
    'session_tip_revisions_reason_ck',
  );
});

it('refuses an empty reason', async () => {
  const sessionId = await session();
  await rejected(
    writeRevision(db, ctx, revisionRow(ids, sessionId, 1, { reason: '' })),
    '23514',
    'session_tip_revisions_reason_ck',
  );
});

it('accepts a 500-character reason', async () => {
  const sessionId = await session();
  const reason = 'x'.repeat(500);
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 2, { reason }));
  const [row] = await inTenant((tx) =>
    tx.execute(
      sql`SELECT char_length(reason)::int AS n FROM session_tip_revisions WHERE session_id=${sessionId} AND revision=2`,
    ),
  );
  expect(row).toEqual({ n: 500 });
});

async function oneTip(sessionId: string, patch: Parameters<typeof tipRow>[3]) {
  const header = revisionRow(ids, sessionId, 1);
  await writeRevision(db, ctx, header, [tipRow(ids, header.id, sessionId, patch)]);
}

it('refuses an amount of zero', async () => {
  const sessionId = await session();
  await rejected(oneTip(sessionId, { amount: '0.000' }), '23514', 'session_tips_amount_ck');
});

it('refuses a negative amount', async () => {
  const sessionId = await session();
  await rejected(oneTip(sessionId, { amount: '-1.000' }), '23514', 'session_tips_amount_ck');
});

it('refuses a NaN amount', async () => {
  const sessionId = await session();
  await rejected(oneTip(sessionId, { amount: 'NaN' }), '23514', 'session_tips_amount_ck');
});

it('accepts the numeric maximum amount', async () => {
  const sessionId = await session();
  await oneTip(sessionId, { amount: '99999999999.999' });
  const [row] = await inTenant((tx) =>
    tx.execute(sql`SELECT amount::text AS amount FROM session_tips WHERE session_id=${sessionId}`),
  );
  expect(row).toEqual({ amount: '99999999999.999' });
});

it('refuses an amount above numeric(14,3)', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  const error = await inTenant(async (tx) => {
    await tx.execute(revisionSql(ctx, header));
    await tx.execute(
      tipSql(ctx, tipRow(ids, header.id, sessionId, { amount: '100000000000.000' })),
    );
  }).then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect((error as { cause?: { code?: string } }).cause?.code).toBe('22003');
});

it('refuses a method outside CASH and CARD', async () => {
  const sessionId = await session();
  await rejected(oneTip(sessionId, { method: 'GIFT' }), '23514', 'session_tips_method_ck');
});

it('refuses a duplicate employee and method in one revision', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await rejected(
    inTenant(async (tx) => {
      await tx.execute(revisionSql(ctx, header));
      await tx.execute(tipSql(ctx, tipRow(ids, header.id, sessionId)));
      await tx.execute(tipSql(ctx, tipRow(ids, header.id, sessionId)));
    }),
    '23505',
    'session_tips_entry_uq',
  );
});

it('accepts the same employee with the other method', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await inTenant(async (tx) => {
    await tx.execute(revisionSql(ctx, header));
    await tx.execute(tipSql(ctx, tipRow(ids, header.id, sessionId, { method: 'CASH' })));
    await tx.execute(tipSql(ctx, tipRow(ids, header.id, sessionId, { method: 'CARD' })));
  });
  const [row] = await inTenant((tx) =>
    tx.execute(sql`SELECT count(*)::int AS n FROM session_tips WHERE session_id=${sessionId}`),
  );
  expect(row).toEqual({ n: 2 });
});

it('accepts a revision with no entries', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  const [row] = await inTenant((tx) =>
    tx.execute(sql`SELECT count(*)::int AS n FROM session_tips WHERE session_id=${sessionId}`),
  );
  expect(row).toEqual({ n: 0 });
});
