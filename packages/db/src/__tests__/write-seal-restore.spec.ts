import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { systemUuidV7 } from '@pospay/ids';

import { createDatabase, type Database } from '../index.ts';
import { createTestDatabase, type TestDatabase } from '../../test/test-database.ts';
import { seedTwoTenants } from '../../test/tenancy-fixtures.ts';
import { seedOrders, ORDER_IDS } from '../../test/orders-fixture.ts';
import { openSession, tenantA as tipTenant, type TipCtx } from '../../test/session-tip.ts';
import {
  performer,
  recordLine,
  seedPerformerChangeStaff,
  tenantA as changeTenant,
  type ChangeCtx,
} from '../../test/service-line-performer-change.ts';

const FOREIGN_CLUSTER = 4242;
const LINE = '01920000-0000-7000-8000-000000004480';

let testDb: TestDatabase;
let owner: postgres.Sql;
let app: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const tipCtx: TipCtx = tipTenant();
const changeCtx: ChangeCtx = changeTenant();

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  app = postgres(testDb.appUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  await seedPerformerChangeStaff(owner, changeCtx);
  db = createDatabase({ url: testDb.appUrl, ids });
  await recordLine(db, changeCtx, ids, LINE, 2, [performer(ORDER_IDS.employee)]);
});

afterAll(async () => {
  await db?.close();
  await app?.end();
  await owner?.end();
  await testDb?.drop();
});

type Failure = { code?: string; constraint_name?: string; cause?: Failure };

const detail = (error: unknown) => {
  const failure = error as Failure;
  return {
    code: failure?.code ?? failure?.cause?.code,
    constraint: failure?.constraint_name ?? failure?.cause?.constraint_name,
  };
};

// postgres.js بيسقط المعاملة كلها لو statement فشال جوّاها، فالرفض المتوقّع بيتعمل في transaction manually.
async function rolledBack(work: () => Promise<void>) {
  await owner`BEGIN`;
  try {
    await work();
  } finally {
    await owner`ROLLBACK`;
  }
}

async function committed(work: () => Promise<void>) {
  await owner`BEGIN`;
  try {
    await work();
    await owner`COMMIT`;
  } catch (error) {
    await owner`ROLLBACK`;
    throw error;
  }
}

/** The app role inside the owner's transaction: the guards read app.company_id, so the context must be set. */
async function asApp(tx: postgres.Sql, company: string) {
  await tx`SELECT set_config('app.company_id', ${company}, true)`;
  await tx`SET LOCAL ROLE pospay_app`;
}

/** Runs the statement and rolls the savepoint back, so the transaction survives the refusal. */
async function failing(tx: postgres.Sql, work: () => Promise<unknown>) {
  await tx`SAVEPOINT seal_check`;
  const error = await work().then(
    () => null,
    (caught: unknown) => caught,
  );
  await tx`ROLLBACK TO SAVEPOINT seal_check`;
  return error;
}

const insertRevision = (
  tx: postgres.Sql,
  revisionId: string,
  sessionId: string,
  revision: number,
  previous: number | null,
) =>
  tx`INSERT INTO session_tip_revisions(company_id,id,business_id,session_id,revision,previous_revision,
    changed_by,changed_by_membership_id,changed_at,reason,event_id,write_xid)
    VALUES(${tipCtx.company},${revisionId},${tipCtx.business},${sessionId},${revision},${previous},
      ${tipCtx.userId},${tipCtx.membershipId},clock_timestamp(),${previous === null ? null : 'Replaced the tip'},
      ${ids.newId()},'1'::xid8)`;

const insertTip = (tx: postgres.Sql, sessionId: string, revisionId: string) =>
  tx`INSERT INTO session_tips(company_id,id,business_id,revision_id,session_id,employee_id,method,amount)
    VALUES(${tipCtx.company},${ids.newId()},${tipCtx.business},${revisionId},${sessionId},
      ${tipCtx.employeeId},'CARD','1.000')`;

const forgeCluster = (tx: postgres.Sql, revisionId: string, cluster: number) =>
  tx`UPDATE session_tip_revisions SET write_system_id=${cluster}
    WHERE company_id=${tipCtx.company} AND id=${revisionId}`;

it('stamps the cluster identifier over a client-supplied value', async () => {
  const sessionId = ids.newId();
  await openSession(owner, tipCtx, sessionId);
  const revision = ids.newId();
  await rolledBack(async () => {
    await asApp(owner, tipCtx.company);
    const [row] =
      await owner`INSERT INTO session_tip_revisions(company_id,id,business_id,session_id,revision,previous_revision,
        changed_by,changed_by_membership_id,changed_at,reason,event_id,write_xid,write_system_id)
      VALUES(${tipCtx.company},${revision},${tipCtx.business},${sessionId},1,NULL,
        ${tipCtx.userId},${tipCtx.membershipId},clock_timestamp(),NULL,${ids.newId()},'1'::xid8,${FOREIGN_CLUSTER})
      RETURNING write_system_id::text AS stamped, public.pospay_system_id()::text AS cluster`;
    expect(row?.['stamped']).toBe(row?.['cluster']);
    expect(row?.['stamped']).not.toBe(String(FOREIGN_CLUSTER));
  });
});

it('refuses a tip row whose revision carries another cluster identifier', async () => {
  const sessionId = ids.newId();
  await openSession(owner, tipCtx, sessionId);
  const revision = ids.newId();
  await rolledBack(async () => {
    await asApp(owner, tipCtx.company);
    await insertRevision(owner, revision, sessionId, 1, null);
    await owner`RESET ROLE`;
    await forgeCluster(owner, revision, FOREIGN_CLUSTER);
    await asApp(owner, tipCtx.company);
    const [row] = await owner`SELECT write_xid::text AS xid, pg_current_xact_id()::text AS current
      FROM session_tip_revisions WHERE id=${revision}`;
    expect(row?.['xid']).toBe(row?.['current']);
    const error = await failing(owner, () => insertTip(owner, sessionId, revision));
    expect(detail(error)).toEqual({ code: '23514', constraint: 'session_tips_current_xact' });
  });
});

it('never counts a legacy row with the zero sentinel as current', async () => {
  const sessionId = ids.newId();
  await openSession(owner, tipCtx, sessionId);
  const revision = ids.newId();
  await rolledBack(async () => {
    await asApp(owner, tipCtx.company);
    await insertRevision(owner, revision, sessionId, 1, null);
    await owner`RESET ROLE`;
    await forgeCluster(owner, revision, 0);
    await asApp(owner, tipCtx.company);
    const error = await failing(owner, () => insertTip(owner, sessionId, revision));
    expect(detail(error)).toEqual({ code: '23514', constraint: 'session_tips_current_xact' });
  });
});

it('keeps a legitimate header for the same session beside a restored one', async () => {
  const sessionId = ids.newId();
  await openSession(owner, tipCtx, sessionId);
  const forged = ids.newId();
  const legitimate = ids.newId();
  await committed(async () => {
    await asApp(owner, tipCtx.company);
    await insertRevision(owner, forged, sessionId, 1, null);
    await owner`RESET ROLE`;
    await forgeCluster(owner, forged, FOREIGN_CLUSTER);
    await asApp(owner, tipCtx.company);
    await insertRevision(owner, legitimate, sessionId, 2, 1);
    await insertTip(owner, sessionId, legitimate);
  });
  const rows = await owner`SELECT write_system_id::text AS cluster FROM session_tip_revisions
    WHERE company_id=${tipCtx.company} AND session_id=${sessionId} ORDER BY revision`;
  expect(rows.map((row) => row['cluster'])).toEqual([String(FOREIGN_CLUSTER), expect.any(String)]);
});

it('refuses a side row and a performer delete for a header from another cluster', async () => {
  const change = ids.newId();
  await rolledBack(async () => {
    await asApp(owner, changeCtx.company);
    await owner`INSERT INTO service_line_performer_changes(company_id,id,business_id,line_id,revision,previous_revision,reason,changed_at,
      changed_by,changed_by_membership_id,changer_name_en,write_xid)
      VALUES(${changeCtx.company},${change},${changeCtx.business},${LINE},2,1,'Changed performers',clock_timestamp(),
        ${changeCtx.userId},${changeCtx.membershipId},'Changer','1'::xid8)`;
    await owner`RESET ROLE`;
    await owner`UPDATE service_line_performer_changes SET write_system_id=${FOREIGN_CLUSTER}
      WHERE company_id=${changeCtx.company} AND id=${change}`;
    await asApp(owner, changeCtx.company);
    const side = await failing(
      owner,
      () =>
        owner`INSERT INTO service_line_performer_change_rows(company_id,id,business_id,change_id,side,employee_id,performer_ordinal,share_bps,
        name_en,linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning)
        VALUES(${changeCtx.company},${ids.newId()},${changeCtx.business},${change},'BEFORE',${ORDER_IDS.employee},1,10000,
          'Synthetic',true,false,false)`,
    );
    expect(detail(side)).toEqual({ code: '23514', constraint: 'slpcr_current_xact' });
    const removed = await failing(
      owner,
      () =>
        owner`DELETE FROM line_performers WHERE company_id=${changeCtx.company} AND line_id=${LINE}`,
    );
    expect(detail(removed)).toEqual({ code: '23514', constraint: 'line_performers_change_guard' });
  });
});

it('keeps a legitimate header for the same line beside a restored one', async () => {
  const change = ids.newId();
  await rolledBack(async () => {
    await asApp(owner, changeCtx.company);
    await owner`INSERT INTO service_line_performer_changes(company_id,id,business_id,line_id,revision,previous_revision,reason,changed_at,
      changed_by,changed_by_membership_id,changer_name_en,write_xid)
      VALUES(${changeCtx.company},${change},${changeCtx.business},${LINE},2,1,'Changed performers',clock_timestamp(),
        ${changeCtx.userId},${changeCtx.membershipId},'Changer','1'::xid8)`;
    await owner`RESET ROLE`;
    await owner`UPDATE service_line_performer_changes SET write_system_id=${FOREIGN_CLUSTER}
      WHERE company_id=${changeCtx.company} AND id=${change}`;
    await asApp(owner, changeCtx.company);
    await owner`UPDATE service_lines SET revision=2 WHERE company_id=${changeCtx.company} AND id=${LINE}`;
    const legitimate = ids.newId();
    await owner`INSERT INTO service_line_performer_changes(company_id,id,business_id,line_id,revision,previous_revision,reason,changed_at,
      changed_by,changed_by_membership_id,changer_name_en,write_xid)
      VALUES(${changeCtx.company},${legitimate},${changeCtx.business},${LINE},3,2,'Changed performers',clock_timestamp(),
        ${changeCtx.userId},${changeCtx.membershipId},'Changer','1'::xid8)`;
    await owner`INSERT INTO service_line_performer_change_rows(company_id,id,business_id,change_id,side,employee_id,performer_ordinal,share_bps,
      name_en,linked_user_snapshotted,not_clocked_in_warning,approved_leave_warning)
      VALUES(${changeCtx.company},${ids.newId()},${changeCtx.business},${legitimate},'BEFORE',${ORDER_IDS.employee},1,10000,
        'Synthetic',true,false,false)`;
  });
});

it('the runtime role reads the identifier and may not rewrite the seal', async () => {
  const [ownerValue] = await owner`SELECT public.pospay_system_id()::text AS id`;
  const [appValue] = await app`SELECT public.pospay_system_id()::text AS id`;
  expect(Number(ownerValue?.['id'])).toBeGreaterThan(0);
  expect(appValue?.['id']).toBe(ownerValue?.['id']);
  for (const table of ['session_tip_revisions', 'service_line_performer_changes']) {
    const rows =
      await owner`SELECT privilege, has_table_privilege('pospay_app', ${table}, privilege) AS allowed
      FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS privilege`;
    expect(rows.filter((row) => row['allowed'] === true).map((row) => row['privilege'])).toEqual([
      'SELECT',
      'INSERT',
    ]);
  }
});
