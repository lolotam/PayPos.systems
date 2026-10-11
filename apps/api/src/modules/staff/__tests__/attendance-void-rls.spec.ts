import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  attendanceChangeFixture,
  changeActor,
  voidInput,
  voidRow,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { leaveIds } from './leave.fixture.ts';

let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture(true);
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('FORCE RLS hides another company’s void marks and refuses updates', async () => {
  const input = await voidInput(f);
  await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
  await f.db.withTenant(f.otherCompany, async (tx) => {
    expect(
      await tx.execute(
        sql`SELECT voided_at,voided_by,void_request_id FROM attendance_sessions WHERE id=${input.session_id}`,
      ),
    ).toHaveLength(0);
    expect(
      await tx.execute(
        sql`UPDATE attendance_sessions SET voided_at=NULL,voided_by=NULL,void_request_id=NULL WHERE id=${input.session_id} RETURNING id`,
      ),
    ).toHaveLength(0);
  });
  expect(await voidRow(f, input.session_id)).toMatchObject({ revision: 1, voided_by: f.owner });
});

it('refuses a foreign request reference at the statement and rolls the marks back', async () => {
  const input = await voidInput(f);
  const foreignId = leaveIds.newId();
  const [foreignBranch] = await f.h
    .owner`SELECT id,business_id FROM branches WHERE company_id=${f.otherCompany} LIMIT 1`;
  const foreignEmployee = leaveIds.newId();
  await f.h
    .owner`INSERT INTO employees(company_id,id,business_id,primary_branch_id,name_en,name_en_key,role_code,hire_date)
    VALUES(${f.otherCompany},${foreignEmployee},${foreignBranch?.business_id},${foreignBranch?.id},'Synthetic foreign employee','synthetic foreign employee','staff','2026-01-01')`;
  await f.h
    .owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,kind,reason,requested_by,requested_at)
    VALUES(${f.otherCompany},${foreignId},${foreignBranch?.business_id},${foreignBranch?.id},${foreignEmployee},'ADD_SESSION','foreign request',${f.owner},'2026-10-04T10:00:00Z')`;
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(
        sql`UPDATE attendance_sessions SET voided_at='2026-10-04T10:00:00Z',voided_by=${f.owner},void_request_id=${foreignId} WHERE id=${input.session_id} RETURNING id`,
      ),
    ),
  ).rejects.toMatchObject({ cause: { code: '23503' } });
  expect(await voidRow(f, input.session_id)).toMatchObject({
    revision: 0,
    voided_at: null,
    voided_by: null,
    void_request_id: null,
  });
});

it('validates marks and kind shape, and installs the immediate FK and concurrent unique backstop', async () => {
  const [fk] = await f.h
    .owner`SELECT condeferrable,condeferred,convalidated FROM pg_constraint WHERE conname='attendance_sessions_void_request_fk'`;
  expect(fk).toMatchObject({ condeferrable: false, condeferred: false, convalidated: true });
  const input = await voidInput(f);
  await expect(
    f.db.withTenant(f.company, (tx) =>
      tx.execute(
        sql`UPDATE attendance_sessions SET voided_at='2026-10-04T10:00:00Z' WHERE id=${input.session_id}`,
      ),
    ),
  ).rejects.toThrow();
  const request = await f.fileChange.execute(changeActor(f), input);
  await expect(f.h
    .owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,kind,session_id,session_revision,reason,requested_by,requested_at)
    SELECT company_id,${leaveIds.newId()},business_id,branch_id,employee_id,'RESTORE_SESSION',session_id,session_revision,reason,requested_by,requested_at FROM attendance_change_requests WHERE id=${request.id}`).rejects.toMatchObject(
    { code: '23505', constraint_name: 'attendance_change_requests_one_pending_session' },
  );
  await expect(f.h
    .owner`INSERT INTO attendance_change_requests(company_id,id,business_id,branch_id,employee_id,kind,reason,requested_by,requested_at)
    SELECT company_id,${leaveIds.newId()},business_id,branch_id,employee_id,'RESTORE_SESSION',reason,requested_by,requested_at FROM attendance_change_requests WHERE id=${request.id}`).rejects.toMatchObject(
    { code: '23514', constraint_name: 'attendance_change_requests_session_kind' },
  );
});
