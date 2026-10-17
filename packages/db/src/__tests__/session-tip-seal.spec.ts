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
  TIP,
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

it('refuses a late entry into an older committed revision', async () => {
  const sessionId = await session();
  const first = revisionRow(ids, sessionId, 1);
  await writeRevision(db, ctx, first);
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 2));
  await rejected(
    inTenant((tx) => tx.execute(tipSql(ctx, tipRow(ids, first.id, sessionId)))),
    '23514',
    'session_tips_current_xact',
  );
});

it('refuses a late entry into the latest committed revision', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await writeRevision(db, ctx, header);
  await rejected(
    inTenant((tx) => tx.execute(tipSql(ctx, tipRow(ids, header.id, sessionId)))),
    '23514',
    'session_tips_current_xact',
  );
});

it('overwrites a client-supplied write_xid', async () => {
  const sessionId = await session();
  const [row] = await inTenant((tx) =>
    tx.execute(
      sql`${revisionSql(ctx, revisionRow(ids, sessionId, 1, { writeXid: '999999999999' }))}
        RETURNING write_xid::text AS stamped, pg_current_xact_id()::text AS current`,
    ),
  );
  expect(row?.['stamped']).toBe(row?.['current']);
  expect(row?.['stamped']).not.toBe('999999999999');
});

it('refuses an entry whose session differs from its revision', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await rejected(
    inTenant(async (tx) => {
      await tx.execute(revisionSql(ctx, header));
      await tx.execute(
        tipSql(ctx, tipRow(ids, header.id, sessionId, { sessionId: TIP.otherSession })),
      );
    }),
    '23503',
    'session_tips_revision_fk',
  );
});

it('refuses an entry whose business differs from its revision', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await rejected(
    inTenant(async (tx) => {
      await tx.execute(revisionSql(ctx, header));
      await tx.execute(
        tipSql(ctx, tipRow(ids, header.id, sessionId, { businessId: TIP.otherBusiness })),
      );
    }),
    '23503',
    'session_tips_revision_fk',
  );
});

it('refuses an employee of another business of the same company', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await rejected(
    inTenant(async (tx) => {
      await tx.execute(revisionSql(ctx, header));
      await tx.execute(
        tipSql(ctx, tipRow(ids, header.id, sessionId, { employeeId: TIP.otherEmployee })),
      );
    }),
    '23503',
    'session_tips_employee_fk',
  );
});

it('refuses an entry after its revision is rolled back to a savepoint', async () => {
  const sessionId = await session();
  const header = revisionRow(ids, sessionId, 1);
  await rejected(
    inTenant(async (tx) => {
      await tx.execute(sql`SAVEPOINT tip_revision`);
      await tx.execute(revisionSql(ctx, header));
      await tx.execute(sql`ROLLBACK TO SAVEPOINT tip_revision`);
      await tx.execute(tipSql(ctx, tipRow(ids, header.id, sessionId)));
    }),
    '23514',
    'session_tips_current_xact',
  );
});

it('lets exactly one of two concurrent second revisions commit', async () => {
  const sessionId = await session();
  await writeRevision(db, ctx, revisionRow(ids, sessionId, 1));
  const results = await Promise.allSettled([
    writeRevision(db, ctx, revisionRow(ids, sessionId, 2, { reason: 'First racer' })),
    writeRevision(db, ctx, revisionRow(ids, sessionId, 2, { reason: 'Second racer' })),
  ]);
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const failure = results.find((result) => result.status === 'rejected');
  const cause = (failure as PromiseRejectedResult).reason as {
    cause?: { constraint_name?: string };
  };
  expect(cause.cause?.constraint_name).toBe('session_tip_revisions_session_revision_uq');
  const rows = await inTenant((tx) =>
    tx.execute(
      sql`SELECT revision FROM session_tip_revisions WHERE session_id=${sessionId} AND revision=2`,
    ),
  );
  expect(rows).toEqual([{ revision: 2 }]);
});
