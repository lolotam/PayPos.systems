import { createOutboxDispatcherDatabase, type OutboxDispatcherDatabase } from '@pospay/db';
import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  A,
  CUSTOMER_A,
  bootstrap,
  db,
  eventId,
  seedSession,
  testDb,
  tip,
  useBootstrapHarness,
  writeTipRevision,
} from '../modules/commissions/__tests__/bootstrap-session-tips-db.harness.ts';
import { createCommissionCoverageReport } from '../modules/commissions/index.ts';
import { createCoverageProjectionReader } from '../modules/commissions/persistence/commission-coverage.reads.ts';
import {
  readCurrentSessionTips,
  readServiceLineCoveragePage,
} from '../modules/orders/index.ts';
import { readSalaryCoveragePage } from '../modules/staff/index.ts';
import { companyOpen } from '../modules/tenancy/index.ts';

useBootstrapHarness();

const TIP_SCOPE = {
  businessIds: [A.business],
  from: '2026-12-01',
  to: '2026-12-31',
};
const BOOTSTRAP_SCOPE = {
  companyId: A.company,
  businessIds: [A.business],
  from: '2026-12-01',
  to: '2026-12-31',
};

let dispatcher: OutboxDispatcherDatabase;

beforeAll(async () => {
  dispatcher = createOutboxDispatcherDatabase({ url: testDb.dispatcherUrl, maxConnections: 1 });
});

afterAll(async () => {
  await dispatcher?.close();
});

function coverageReport() {
  return createCommissionCoverageReport({
    database: db,
    lines: { readPage: readServiceLineCoveragePage },
    salaries: { readPage: readSalaryCoveragePage },
    retained: dispatcher,
    companies: { isOpen: companyOpen },
    tipsReader: { readPage: readCurrentSessionTips },
  });
}

it('the projection reader returns the tip head revision of the tenant and nothing for an empty list', async () => {
  // يثبت أن قارئ الإسقاط يقرأ مراجعة رأس البقشيش من جدول الرؤوس، لا من مراجعات المصدر
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(1), [tip(A.employee, 'CASH', '10.000')]);
  await writeTipRevision(ctx, sessionId, 2, eventId(2), [tip(A.employee, 'CASH', '10.000')]);
  await bootstrap()(BOOTSTRAP_SCOPE);

  const projection = createCoverageProjectionReader();
  const rows = await db.withTenant(A.company, (tx) =>
    projection.tipRevisions(tx, A.company, [sessionId]),
  );
  const empty = await db.withTenant(A.company, (tx) => projection.tipRevisions(tx, A.company, []));

  expect(rows).toEqual([{ sessionId, revision: 2 }]);
  expect(empty).toEqual([]);
});

it('the report covers a tip whose projection revision matches the source and calls it stale when the source moves on', async () => {
  // يثبت أن فحص البقشيش بالمراجعة يقارن المراجعة في المصدر برأس الإسقاط: تطابق يغطي وتقدم المصدر يبقى متأخراً
  const { ctx, sessionId } = await seedSession(A, '2026-12-02', CUSTOMER_A);
  await writeTipRevision(ctx, sessionId, 1, eventId(1), [tip(A.employee, 'CASH', '10.000')]);
  await writeTipRevision(ctx, sessionId, 2, eventId(2), [tip(A.employee, 'CASH', '10.000')]);
  await bootstrap()(BOOTSTRAP_SCOPE);

  const covered = await coverageReport()({
    companyId: A.company,
    throughId: null,
    tips: TIP_SCOPE,
  });

  expect(covered.tips).toEqual({
    checked: 1,
    missing: { total: 0, ids: [] },
    stale: { total: 0, ids: [] },
  });
  expect(covered.tipsNote).toBeNull();
  expect(covered.status).toBe('COVERED');

  await writeTipRevision(ctx, sessionId, 3, eventId(3), [tip(A.employee, 'CARD', '20.000')]);

  const stale = await coverageReport()({
    companyId: A.company,
    throughId: null,
    tips: TIP_SCOPE,
  });

  expect(stale.tips).toEqual({
    checked: 1,
    missing: { total: 0, ids: [] },
    stale: { total: 1, ids: [sessionId] },
  });
  expect(stale.status).toBe('NOT_COVERED');
});
