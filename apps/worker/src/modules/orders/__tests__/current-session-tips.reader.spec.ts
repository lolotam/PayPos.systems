import { createDatabase, type Database } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { ORDER_IDS, seedOrders } from '../../../../../../packages/db/test/orders-fixture.ts';
import {
  openSession,
  revisionRow,
  tenantA,
  tipRow,
  writeRevision,
} from '../../../../../../packages/db/test/session-tip.ts';
import {
  createTestDatabase,
  type TestDatabase,
} from '../../../../../../packages/db/test/test-database.ts';
import { seedTwoTenants, TENANT } from '../../../../../../packages/db/test/tenancy-fixtures.ts';
import { readCurrentSessionTips } from '../queries/current-session-tips.reader.ts';

type Cursor = { businessDate: string; sessionId: string };
type RevisionInput = { tips: readonly { method: 'CASH' | 'CARD'; amount: string }[] };

let testDb: TestDatabase;
let owner: postgres.Sql;
let db: Database;
const ids = systemUuidV7();
const ctx = tenantA();
const RANGE = { from: '2020-01-01', to: '2038-01-01' };
const created: string[] = [];

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedTwoTenants(testDb.ownerUrl);
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
  await seedOrders(owner);
  db = createDatabase({ url: testDb.appUrl, ids });
});

afterAll(async () => {
  await db?.close();
  await owner?.end();
  await testDb?.drop();
});

beforeEach(async () => {
  for (const sessionId of created.splice(0)) {
    await owner`DELETE FROM session_tips WHERE session_id=${sessionId}`;
    await owner`DELETE FROM session_tip_revisions WHERE session_id=${sessionId}`;
    await owner`DELETE FROM service_sessions WHERE id=${sessionId}`;
  }
});

async function createSessionWithTips(revisions: readonly RevisionInput[]) {
  const sessionId = ids.newId();
  await openSession(owner, ctx, sessionId);
  const eventIds: string[] = [];
  for (const [index, revision] of revisions.entries()) {
    const row = revisionRow(ids, sessionId, index + 1);
    const tips = revision.tips.map((tip) => tipRow(ids, row.id, sessionId, tip));
    await writeRevision(db, ctx, row, tips);
    eventIds.push(row.eventId);
  }
  created.push(sessionId);
  return { sessionId, eventIds };
}

const read = (companyId: string, businessId: string, after: Cursor | null, limit: number) =>
  db.withTenant(companyId, (tx) => readCurrentSessionTips(tx, companyId, businessId, RANGE, { after, limit }));

const businessDateOf = async (sessionId: string) => {
  const [row] = await owner`SELECT business_date::text AS business_date FROM service_sessions WHERE id=${sessionId}`;
  if (row === undefined) throw new Error('SESSION_BUSINESS_DATE_MISSING');
  return row.business_date as string;
};

it('returns the current tip state of a session with two revisions', async () => {
  // يثبت أن القارئ يرجع أحدث مراجعة ببقشيشها ومعرّفات أحداث المراجعات بترتيب المراجعة
  const { sessionId, eventIds } = await createSessionWithTips([
    { tips: [{ method: 'CASH', amount: '1.000' }] },
    { tips: [{ method: 'CARD', amount: '1.000' }] },
  ]);
  const page = await read(TENANT.A.company, TENANT.A.business, null, 10);
  const item = page.items.find((entry) => entry.sessionId === sessionId);
  expect(item).toEqual({
    sessionId,
    businessDate: await businessDateOf(sessionId),
    branchId: TENANT.A.branch,
    revision: 2,
    tips: [{ employeeId: ORDER_IDS.employee, method: 'CARD', amount: '1.000' }],
    eventIds,
  });
});

it('returns no tips for a session whose latest revision has none', async () => {
  // يثبت أن المراجعة الفارغة ترجع بقشيشاً فارغاً بلا صفوف مع رأسها بمراجعتها
  const { sessionId } = await createSessionWithTips([
    { tips: [{ method: 'CASH', amount: '1.000' }] },
    { tips: [] },
  ]);
  const page = await read(TENANT.A.company, TENANT.A.business, null, 10);
  const item = page.items.find((entry) => entry.sessionId === sessionId);
  expect(item?.revision).toBe(2);
  expect(item?.tips).toEqual([]);
});
it('refuses another company context and never shows a foreign session', async () => {
  // يثبت عزل المستأجر: شركة B ترفض قراءة حالة شركة A ولا ترى زياراتها
  const { sessionId } = await createSessionWithTips([
    { tips: [{ method: 'CASH', amount: '1.000' }] },
  ]);
  await expect(
    db.withTenant(TENANT.B.company, (tx) =>
      readCurrentSessionTips(tx, TENANT.A.company, TENANT.A.business, RANGE, {
        after: null,
        limit: 10,
      }),
    ),
  ).rejects.toThrow('SESSION_TIPS_BOOTSTRAP_TENANT_MISMATCH');
  const foreign = await read(TENANT.B.company, TENANT.B.business, null, 10);
  expect(foreign.items.map((entry) => entry.sessionId)).not.toContain(sessionId);
});
it('pages by session and returns the next cursor only while a session is left', async () => {
  // يثبت أن الصفحة بمؤشرها ترجع الجلسة التالية ومؤشرها null عند آخر صفحة
  const first = await createSessionWithTips([{ tips: [{ method: 'CASH', amount: '1.000' }] }]);
  const second = await createSessionWithTips([{ tips: [{ method: 'CARD', amount: '1.000' }] }]);
  const order = [first.sessionId, second.sessionId].sort();
  const page1 = await read(TENANT.A.company, TENANT.A.business, null, 1);
  expect(page1.items.map((entry) => entry.sessionId)).toEqual([order[0]]);
  expect(page1.nextCursor).toEqual({
    businessDate: await businessDateOf(order[0] as string),
    sessionId: order[0],
  });
  const page2 = await read(TENANT.A.company, TENANT.A.business, page1.nextCursor, 1);
  expect(page2.items.map((entry) => entry.sessionId)).toEqual([order[1]]);
  expect(page2.nextCursor).toBeNull();
});
