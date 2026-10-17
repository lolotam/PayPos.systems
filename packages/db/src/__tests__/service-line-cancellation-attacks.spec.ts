import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';
import { createDatabase, type Database, type Tx } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants, USER } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import {
  cancelServiceLine,
  historySql,
  type CancelLine,
  type SlcPatch,
} from '../../test/service-line-cancellation.ts';
import {
  applyChange,
  commitChange,
  headerSql,
  liveSql,
  PERFORMER_STAFF,
  performer,
  recordLine,
  seedPerformerChangeStaff,
  tenantA,
  type ChangeCtx,
} from '../../test/service-line-performer-change.ts';

const LINE = {
  live: '01920000-0000-7000-8000-000000004470',
  frozen: '01920000-0000-7000-8000-000000004471',
  happy: '01920000-0000-7000-8000-000000004472',
  priced: '01920000-0000-7000-8000-000000004473',
  swapped: '01920000-0000-7000-8000-000000004474',
  both: '01920000-0000-7000-8000-000000004475',
  immediate: '01920000-0000-7000-8000-000000004476',
  race: '01920000-0000-7000-8000-000000004477',
};
let testDb: TestDatabase, owner: postgres.Sql, db: Database;
const ids = systemUuidV7();
const ctx: ChangeCtx = tenantA();
const calm = performer(ORDER_IDS.employee, { nameEn: 'Calm' });
const other = performer(PERFORMER_STAFF.emp2, { nameEn: 'Other' });

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedPerformerChangeStaff(owner, ctx);
  db = createDatabase({ url: testDb.appUrl, ids, maxConnections: 4 });
  const lines: [string, number][] = [
    [LINE.live, 2],
    [LINE.frozen, 3],
    [LINE.happy, 4],
    [LINE.priced, 5],
    [LINE.swapped, 6],
    [LINE.both, 7],
    [LINE.immediate, 8],
    [LINE.race, 9],
  ];
  for (const [lineId, ordinal] of lines) await recordLine(db, ctx, ids, lineId, ordinal, [calm]);
  await cancel(LINE.frozen, 1);
});
afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

function pgError(error: unknown): { code?: string; constraint_name?: string; message?: string } {
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

async function refused(work: Promise<unknown>, constraint: string, code = '23514') {
  const error = await work.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(Error);
  expect([pgError(error).code, pgError(error).constraint_name]).toEqual([code, constraint]);
  return pgError(error).message;
}

const run = (query: ReturnType<typeof sql>) =>
  db.withTenant(ctx.company, (tx) => tx.execute(query), { userId: USER });

const inTx = (work: (tx: Tx) => Promise<void>) =>
  db.withTenant(ctx.company, work, { userId: USER });

function input(lineId: string, expectedRevision: number): CancelLine {
  return {
    companyId: ctx.company,
    lineId,
    expectedRevision,
    cancelledBy: ctx.userId,
    membershipId: ctx.membershipId,
    cancellationId: ids.newId(),
  };
}

function cancel(lineId: string, expectedRevision: number) {
  return db.withTenant(
    ctx.company,
    (tx) => cancelServiceLine(tx, input(lineId, expectedRevision)),
    { userId: USER },
  );
}

const history = (lineId: string, revision: number, previous: number, patch: SlcPatch = {}) =>
  historySql(ctx, ids.newId(), lineId, revision, previous, patch);

const cancelSql = (lineId: string, revision: ReturnType<typeof sql> = sql`revision+1`) =>
  sql`UPDATE service_lines SET status='CANCELLED', revision=${revision}
    WHERE company_id=${ctx.company} AND id=${lineId} AND status='ACTIVE' AND revision=1`;

it('commits a cancel with the line figures and performers unchanged', async () => {
  await cancel(LINE.happy, 1);
  expect(
    await run(sql`SELECT status, revision, price::text AS price, discount::text AS discount, net::text AS net
    FROM service_lines WHERE id=${LINE.happy}`),
  ).toEqual([
    { status: 'CANCELLED', revision: 2, price: '1.000', discount: '0.000', net: '1.000' },
  ]);
  expect(
    await run(sql`SELECT employee_id FROM line_performers WHERE line_id=${LINE.happy}`),
  ).toEqual([{ employee_id: ORDER_IDS.employee }]);
  expect(
    await run(sql`SELECT revision, previous_revision, previous_price::text AS previous_price,
    previous_discount::text AS previous_discount, previous_net::text AS previous_net
    FROM service_line_cancellations WHERE line_id=${LINE.happy}`),
  ).toEqual([
    {
      revision: 2,
      previous_revision: 1,
      previous_price: '1.000',
      previous_discount: '0.000',
      previous_net: '1.000',
    },
  ]);
});

it('cancels a line after a committed price edit', async () => {
  await run(
    sql`UPDATE service_lines SET price=2.000, discount=0.500, net=1.500, revision=revision+1 WHERE id=${LINE.priced}`,
  );
  await cancel(LINE.priced, 2);
  expect(
    await run(sql`SELECT revision, previous_price::text AS previous_price, previous_discount::text AS previous_discount,
    previous_net::text AS previous_net FROM service_line_cancellations WHERE line_id=${LINE.priced}`),
  ).toEqual([
    { revision: 3, previous_price: '2.000', previous_discount: '0.500', previous_net: '1.500' },
  ]);
  expect(
    await run(sql`SELECT employee_id FROM line_performers WHERE line_id=${LINE.priced}`),
  ).toEqual([{ employee_id: ORDER_IDS.employee }]);
});

it('cancels a line after a committed performer change', async () => {
  await commitChange(db, ctx, ids, {
    lineId: LINE.swapped,
    before: [calm],
    after: [other],
    live: [other],
  });
  await cancel(LINE.swapped, 2);
  expect(
    await run(
      sql`SELECT status, revision, price::text AS price FROM service_lines WHERE id=${LINE.swapped}`,
    ),
  ).toEqual([{ status: 'CANCELLED', revision: 3, price: '1.000' }]);
  expect(
    await run(sql`SELECT employee_id FROM line_performers WHERE line_id=${LINE.swapped}`),
  ).toEqual([{ employee_id: PERFORMER_STAFF.emp2 }]);
});

it('refuses to record a line as cancelled', async () => {
  const message = await refused(
    run(sql`INSERT INTO service_lines(company_id,id,business_id,session_id,service_id,ordinal,input_index,status,revision,
    list_price,price,discount,net,effective_discount_bps,limit_source,limit_bps_applied,name_en,catalog_revision,rule_kind,counts_toward_threshold,
    has_performer_warning,recorded_by,recorded_by_membership_id,recorded_at,late)
    VALUES(${ctx.company},${ids.newId()},${ctx.business},${ctx.sessionId},${ctx.serviceId},19,18,'CANCELLED',1,1.000,1.000,0.000,1.000,
      0,'OWNER',NULL,'Synthetic',1,'ZERO',true,false,${ctx.userId},${ctx.membershipId},now(),false)`),
    'service_lines_cancel_guard',
  );
  expect(message).toBe('a service line is recorded ACTIVE');
});

it('refuses a cancel that writes no history row', async () => {
  await refused(run(cancelSql(LINE.live)), 'slc_complete');
});

it('refuses a history row for an active line', async () => {
  await refused(run(history(LINE.live, 2, 1)), 'slc_complete');
});

it('refuses a history row whose revision is not the line revision', async () => {
  await refused(
    inTx(async (tx) => {
      await tx.execute(cancelSql(LINE.live));
      await tx.execute(history(LINE.live, 3, 2));
    }),
    'slc_complete',
  );
});

it('refuses a history row whose previous revision is not the line previous revision', async () => {
  await refused(
    inTx(async (tx) => {
      await tx.execute(cancelSql(LINE.live));
      await tx.execute(history(LINE.live, 4, 3));
    }),
    'slc_complete',
  );
});

it('refuses a history row whose figures are not the line figures', async () => {
  await refused(
    inTx(async (tx) => {
      await tx.execute(cancelSql(LINE.live));
      await tx.execute(
        history(LINE.live, 2, 1, { price: '2.000', discount: '0.000', net: '2.000' }),
      );
    }),
    'slc_complete',
  );
});

it('refuses a history row for another business', async () => {
  await refused(
    run(history(LINE.live, 2, 1, { businessId: PERFORMER_STAFF.otherBusiness })),
    'slc_line_fk',
    '23503',
  );
});

it('refuses a second history row for one line', async () => {
  await refused(run(history(LINE.frozen, 2, 1)), 'slc_line_uq', '23505');
});

it('refuses to reinstate a cancelled line', async () => {
  const message = await refused(
    run(sql`UPDATE service_lines SET status='ACTIVE', revision=revision+1 WHERE id=${LINE.frozen}`),
    'service_lines_cancel_guard',
  );
  expect(message).toBe('a cancelled service line is frozen');
});

it('refuses a cancel that advances revision by two', async () => {
  await refused(run(cancelSql(LINE.live, sql`revision+2`)), 'service_lines_cancel_guard');
});

it('refuses a cancel that leaves revision unchanged', async () => {
  await refused(
    run(
      sql`UPDATE service_lines SET status='CANCELLED' WHERE company_id=${ctx.company} AND id=${LINE.live}`,
    ),
    'service_lines_cancel_guard',
  );
});

it('refuses a cancel that also changes the price', async () => {
  await refused(
    run(sql`UPDATE service_lines SET status='CANCELLED', revision=revision+1, price=2.000, discount=0.000, net=2.000
    WHERE company_id=${ctx.company} AND id=${LINE.live}`),
    'service_lines_cancel_guard',
  );
});

it('refuses a cancel that also changes the performer warning', async () => {
  await refused(
    run(sql`UPDATE service_lines SET status='CANCELLED', revision=revision+1, has_performer_warning=true
    WHERE company_id=${ctx.company} AND id=${LINE.live}`),
    'service_lines_cancel_guard',
  );
});

it('refuses a no-op update of a cancelled line', async () => {
  const message = await refused(
    run(sql`UPDATE service_lines SET status=status WHERE id=${LINE.frozen}`),
    'service_lines_cancel_guard',
  );
  expect(message).toBe('a cancelled service line is frozen');
});

it('refuses a price edit of a cancelled line', async () => {
  await refused(
    run(
      sql`UPDATE service_lines SET price=2.000, discount=0.000, net=2.000 WHERE id=${LINE.frozen}`,
    ),
    'service_lines_cancel_guard',
  );
});

it('refuses a performer insert on a cancelled line', async () => {
  await refused(
    run(liveSql(ctx, ids.newId(), LINE.frozen, performer(ORDER_IDS.employee, { ordinal: 2 }))),
    'line_performers_cancel_guard',
  );
});

it('refuses a performer delete on a cancelled line', async () => {
  await refused(
    run(
      sql`DELETE FROM line_performers WHERE company_id=${ctx.company} AND line_id=${LINE.frozen}`,
    ),
    'line_performers_cancel_guard',
  );
});

it('refuses a performer-change header then a revision update on a cancelled line', async () => {
  await refused(
    inTx(async (tx) => {
      await tx.execute(
        headerSql(
          ctx,
          { lineId: LINE.frozen, previous: 2, revision: 3, before: [], after: [], live: [] },
          ids.newId(),
        ),
      );
      await tx.execute(
        sql`UPDATE service_lines SET revision=revision+1 WHERE company_id=${ctx.company} AND id=${LINE.frozen}`,
      );
    }),
    'service_lines_cancel_guard',
  );
});

it('refuses a performer change and a cancel of the same line in one transaction', async () => {
  await refused(
    inTx(async (tx) => {
      await applyChange(tx, ctx, ids, {
        lineId: LINE.both,
        before: [calm],
        after: [other],
        live: [other],
      });
      await cancelServiceLine(tx, input(LINE.both, 2));
    }),
    'service_lines_performer_transition',
  );
});

it('refuses to close the coupling before the history row is written', async () => {
  await refused(
    inTx(async (tx) => {
      await tx.execute(cancelSql(LINE.live));
      await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
    }),
    'slc_complete',
  );
});

it('accepts both writes when constraints are made immediate afterwards', async () => {
  await inTx(async (tx) => {
    await cancelServiceLine(tx, input(LINE.immediate, 1));
    await tx.execute(sql`SET CONSTRAINTS ALL IMMEDIATE`);
  });
  expect(
    await run(sql`SELECT status, revision FROM service_lines WHERE id=${LINE.immediate}`),
  ).toEqual([{ status: 'CANCELLED', revision: 2 }]);
});

it('leaves the line active when the cancel rolls back to a savepoint', async () => {
  await inTx(async (tx) => {
    await tx.execute(sql`SAVEPOINT cancel_line`);
    await cancelServiceLine(tx, input(LINE.live, 1));
    await tx.execute(sql`ROLLBACK TO SAVEPOINT cancel_line`);
  });
  expect(await run(sql`SELECT status, revision FROM service_lines WHERE id=${LINE.live}`)).toEqual([
    { status: 'ACTIVE', revision: 1 },
  ]);
  expect(
    await run(sql`SELECT id FROM service_line_cancellations WHERE line_id=${LINE.live}`),
  ).toEqual([]);
});

it('lets exactly one of two concurrent cancels commit', async () => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = inTx(async (tx) => {
    await tx.execute(
      sql`SELECT id FROM service_lines WHERE company_id=${ctx.company} AND id=${LINE.race} FOR UPDATE`,
    );
    release();
    await tx.execute(sql`SELECT pg_sleep(0.2)`);
    await cancelServiceLine(tx, input(LINE.race, 1));
  });
  const results = await Promise.allSettled([first, held.then(() => cancel(LINE.race, 1))]);
  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
  const reason = rejected.reason as Error & { cause?: Error };
  expect(`${reason.message} ${reason.cause?.message ?? ''}`).toContain(
    'service line cancel compare-and-set matched no row',
  );
  expect(await run(sql`SELECT status, revision FROM service_lines WHERE id=${LINE.race}`)).toEqual([
    { status: 'CANCELLED', revision: 2 },
  ]);
  expect(
    await run(sql`SELECT id FROM service_line_cancellations WHERE line_id=${LINE.race}`),
  ).toHaveLength(1);
});

it('refuses a reason that is not trimmed', async () => {
  await refused(run(history(LINE.live, 2, 1, { reason: ' Cancelled ' })), 'slc_reason_ck');
});

it('refuses a NaN previous price', async () => {
  await refused(
    run(history(LINE.live, 2, 1, { price: 'NaN', net: 'NaN' })),
    'slc_previous_amounts_ck',
  );
});

it('refuses a role snapshot that is only partly filled', async () => {
  await refused(
    run(history(LINE.live, 2, 1, { role: 'owner', roleName: 'Owner' })),
    'slc_canceller_role_snapshot_ck',
  );
});
