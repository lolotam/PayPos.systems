import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  leaveActor,
  leaveFixture,
  leaveIds,
  leaveTerms,
  type LeaveFixture,
} from './leave.fixture.ts';
let f: LeaveFixture;
let rowId: string;
beforeAll(async () => {
  f = await leaveFixture();
  rowId = (await f.request.execute(leaveActor(f), leaveTerms())).id;
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
function insert(company: string, branch = f.branch, id = leaveIds.newId()) {
  return sql`INSERT INTO leave_requests(company_id,id,business_id,branch_id,employee_id,kind,"from","to",timezone,starts_at,ends_at,type,requested_by,requested_at)
 VALUES(${company},${id},${f.business},${branch},${f.employee.id},'FULL_DAY','2027-05-01','2027-05-01','Asia/Kuwait','2027-04-30T21:00Z','2027-05-01T21:00Z','SICK',${f.userId},'2026-10-04T10:00Z')`;
}
it('forces RLS and hides reads/updates outside tenant and without context', async () => {
  expect(
    await f.h
      .owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='leave_requests'`,
  ).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(sql`SELECT id FROM leave_requests WHERE company_id=${f.company}`),
    ),
  ).toHaveLength(0);
  expect(
    await f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`UPDATE leave_requests SET revision=revision+1 WHERE company_id=${f.company} RETURNING id`,
      ),
    ),
  ).toHaveLength(0);
  const app = postgres(f.h.urls.app, { max: 1 });
  try {
    expect(await app`SELECT id FROM leave_requests`).toHaveLength(0);
  } finally {
    await app.end();
  }
});
it('rejects cross-tenant insert/upsert, foreign parents, deletion and mutable identity/period', async () => {
  await expect(
    f.db.withTenant(f.otherCompany, (tx) => tx.execute(insert(f.company))),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`${insert(f.company, f.branch, rowId)} ON CONFLICT(company_id,id) DO UPDATE SET revision=revision+1`,
      ),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.company, (tx) => tx.execute(insert(f.company, f.foreignBranch))),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.otherCompany, (tx) => tx.execute(insert(f.otherCompany))),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`DELETE FROM leave_requests WHERE id=${rowId}`),
    ),
  ).rejects.toThrow();
  for (const column of ['company_id', 'employee_id', 'branch_id', 'starts_at', 'note'])
    await expect(
      f.db.withTenant(f.company, (tx) =>
        tx.execute(
          sql`UPDATE leave_requests SET ${sql.identifier(column)}=${sql.identifier(column)} WHERE id=${rowId}`,
        ),
      ),
    ).rejects.toThrow();
});
it('database guards overlap and lifecycle invariants even without the domain', async () => {
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE leave_requests SET status='CANCELLED' WHERE id=${rowId}`),
    ),
  ).rejects.toThrow();
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(sql`UPDATE leave_requests SET revision=0 WHERE id=${rowId}`),
    ),
  ).rejects.toThrow();
  await f.db.withTenant(f.company, (tx) => tx.execute(insert(f.company)));
  await expect(
    f.db.withTenant(f.company, (tx) => tx.execute(insert(f.company, f.secondBranch))),
  ).rejects.toThrow();
});
