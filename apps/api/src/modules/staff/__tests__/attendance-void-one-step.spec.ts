import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  attendanceChangeFixture,
  changeActor,
  voidInput,
  voidRow,
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
const linkedRequest = async (sessionId: string) => {
  const [row] = await f.h.owner`SELECT r.id,r.status,r.kind FROM attendance_sessions s
    JOIN attendance_change_requests r ON r.company_id=s.company_id AND r.id=s.void_request_id
    WHERE s.company_id=${f.company} AND s.id=${sessionId}`;
  return row;
};
const requestRows = async (sessionId: string) =>
  f.h.owner`SELECT id,kind,status FROM attendance_change_requests
    WHERE company_id=${f.company} AND session_id=${sessionId} ORDER BY requested_at,id`;

it('owner one-step VOID links void_request_id to the persisted request through the FK', async () => {
  const input = await voidInput(f);
  const row = await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
  expect(row).toMatchObject({ status: 'APPROVED', kind: 'VOID_SESSION', revision: 1 });
  expect(await voidRow(f, input.session_id)).toMatchObject({
    void_request_id: row.id,
    voided_by: f.owner,
    revision: 1,
  });
  expect(await linkedRequest(input.session_id)).toEqual({
    id: row.id,
    status: 'APPROVED',
    kind: 'VOID_SESSION',
  });
  await expect(
    f.h
      .owner`UPDATE attendance_sessions SET void_request_id=${f.owner} WHERE company_id=${f.company} AND id=${input.session_id}`,
  ).rejects.toMatchObject({ code: '23503' });
});

it('owner one-step RESTORE clears the marks and keeps the original void request as history', async () => {
  const input = await voidInput(f);
  const original = await f.fileChange.execute(changeActor(f, undefined, f.owner), input);
  const restore = await f.fileChange.execute(changeActor(f, undefined, f.owner), {
    ...input,
    kind: 'RESTORE_SESSION',
    session_revision: 1,
  });
  expect(restore).toMatchObject({ status: 'APPROVED', kind: 'RESTORE_SESSION', revision: 1 });
  expect(await voidRow(f, input.session_id)).toMatchObject({
    voided_at: null,
    voided_by: null,
    void_request_id: null,
    revision: 2,
  });
  expect(await requestRows(input.session_id)).toEqual([
    { id: original.id, kind: 'VOID_SESSION', status: 'APPROVED' },
    { id: restore.id, kind: 'RESTORE_SESSION', status: 'APPROVED' },
  ]);
});

it('ACR-Q11 owner one-step VOID behind a pending void is 409 and leaves no row behind', async () => {
  const input = await voidInput(f);
  const pending = await f.fileChange.execute(changeActor(f), input);
  await expect(
    f.fileChange.execute(changeActor(f, undefined, f.owner), input),
  ).rejects.toMatchObject({ code: 'ATTENDANCE_CHANGE_DUPLICATE_PENDING', status: 409 });
  expect(await requestRows(input.session_id)).toEqual([
    { id: pending.id, kind: 'VOID_SESSION', status: 'PENDING' },
  ]);
  expect(await voidRow(f, input.session_id)).toMatchObject({ void_request_id: null, revision: 0 });
});
