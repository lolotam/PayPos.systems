import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture();
  await f.fileChange.execute(changeActor(f), changeInput(f));
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});
it('FORCE RLS hides foreign reads and updates and refuses cross-tenant inserts', async () => {
  const [flags] = await f.h
    .owner`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname='attendance_change_requests'`;
  expect(flags).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  await f.db.withTenant(f.otherCompany, async (tx) => {
    expect(await tx.execute(sql`SELECT id FROM attendance_change_requests`)).toHaveLength(0);
    expect(
      await tx.execute(sql`UPDATE attendance_change_requests SET revision=revision RETURNING id`),
    ).toHaveLength(0);
  });
  const [row] = await f.h
    .owner`SELECT row_to_json(r) AS record FROM attendance_change_requests r LIMIT 1`;
  await expect(
    f.db.withTenant(f.otherCompany, (tx) =>
      tx.execute(
        sql`INSERT INTO attendance_change_requests SELECT (json_populate_record(NULL::attendance_change_requests,${JSON.stringify(row?.record)}::json)).*`,
      ),
    ),
  ).rejects.toThrow();
});
it('permits only the lifecycle update columns and never DELETE, even for the current tenant', async () => {
  const rows = await f.db.withTenant(f.company, (tx) =>
    tx.execute(
      sql`UPDATE attendance_change_requests SET status=status,decided_by=decided_by,decided_at=decided_at,decision_reason=decision_reason,cancelled_by=cancelled_by,cancelled_at=cancelled_at,session_id=session_id,revision=revision RETURNING id`,
    ),
  );
  expect(rows).toHaveLength(1);
  for (const column of [
    'company_id',
    'id',
    'business_id',
    'branch_id',
    'employee_id',
    'kind',
    'session_revision',
    'reason',
    'requested_by',
    'requested_at',
  ]) {
    const name = sql.identifier(column);
    await expect(
      f.db.withTenant(f.company, (tx) =>
        tx.execute(sql`UPDATE attendance_change_requests SET ${name}=${name}`),
      ),
    ).rejects.toThrow();
  }
  await expect(
    f.db.withTenant(f.company, (tx) => tx.execute(sql`DELETE FROM attendance_change_requests`)),
  ).rejects.toThrow();
});
it('has no unscoped application reads or auth-role access', async () => {
  const app = postgres(f.h.urls.app, { max: 1 });
  const auth = postgres(f.h.urls.auth, { max: 1 });
  try {
    expect(await app`SELECT id FROM attendance_change_requests`).toHaveLength(0);
    await expect(auth`SELECT id FROM attendance_change_requests`).rejects.toThrow();
  } finally {
    await app.end();
    await auth.end();
  }
});
