import { afterAll, beforeAll, expect, it } from 'vitest';
import { attendanceChangeRequestPage } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { attendanceChangePageStatement } from '../queries/attendance-change-requests.query.ts';
import {
  attendanceChangeFixture,
  changeActor,
  voidInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

async function list() {
  const response = await f.h.app.inject({
    method: 'GET',
    url: `/v1/businesses/${f.business}/attendance-change-requests?limit=100`,
    headers: { cookie: f.approverCookie, 'x-company-id': f.company },
  });
  expect(response.statusCode).toBe(200);
  return attendanceChangeRequestPage.parse(response.json()).items;
}

it('lists live state through void approval, pending restore, restore approval and a later void', async () => {
  const input = await voidInput(f);
  const filed = await f.fileChange.execute(changeActor(f), input);
  expect((await list()).find((row) => row.id === filed.id)?.session_state).toEqual({
    voided: false,
    void_request_id: null,
    restore_pending: false,
  });
  await f.decideChange.execute(changeActor(f, filed.id, f.owner), {
    decision: 'APPROVED',
    revision: 0,
  });
  expect((await list()).find((row) => row.id === filed.id)?.session_state).toEqual({
    voided: true,
    void_request_id: filed.id,
    restore_pending: false,
  });
  const restore = await f.fileChange.execute(changeActor(f), {
    ...input,
    kind: 'RESTORE_SESSION',
    session_revision: 1,
  });
  const pending = await list();
  for (const id of [filed.id, restore.id]) {
    expect(pending.find((row) => row.id === id)?.session_state).toEqual({
      voided: true,
      void_request_id: filed.id,
      restore_pending: true,
    });
  }
  await f.decideChange.execute(changeActor(f, restore.id, f.owner), {
    decision: 'APPROVED',
    revision: 0,
  });
  const restored = await list();
  for (const id of [filed.id, restore.id]) {
    expect(restored.find((row) => row.id === id)?.session_state).toEqual({
      voided: false,
      void_request_id: null,
      restore_pending: false,
    });
  }
  const later = await f.fileChange.execute(changeActor(f, undefined, f.owner), {
    ...input,
    session_revision: 2,
  });
  expect((await list()).find((row) => row.id === filed.id)?.session_state).toEqual({
    voided: true,
    void_request_id: later.id,
    restore_pending: false,
  });
});

it('EXPLAIN ANALYZE uses the tenant session join and existing pending-session index', async () => {
  const input = await voidInput(f);
  await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
  await f.fileChange.execute(changeActor(f), {
    ...input,
    kind: 'RESTORE_SESSION',
    session_revision: 1,
  });
  const context = { companyId: f.company, businessId: f.business, userId: f.owner };
  const access = { owner: true, canDecide: true, decideBranches: [f.branch], branches: [f.branch] };
  const plan = await f.db.withTenant(f.company, async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    return tx.execute(sql`EXPLAIN (ANALYZE,FORMAT JSON)
      ${attendanceChangePageStatement(context, { limit: 50 }, access)}`);
  });
  expect(JSON.stringify(plan)).toContain('attendance_sessions_company_id_id_pk');
  expect(JSON.stringify(plan)).toContain('attendance_change_requests_one_pending_session');
  const foreign = await f.db.withTenant(f.otherCompany, (tx) =>
    tx.execute(attendanceChangePageStatement(context, { limit: 50 }, access)),
  );
  expect(foreign).toEqual([]);
});
