import {
  attendanceChangeFixture,
  changeActor,
  changeInput,
  changeAudits,
  changeEvents,
  effectCount,
  type ChangeFixture,
} from './attendance-change.fixture.ts';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { OWNER_ROLE_ID } from '@pospay/db';
import { leaveIds } from './leave.fixture.ts';
import { createAttendanceChangeTransactions } from '../persistence/drizzle-attendance-change-transactions.ts';
import { DecideAttendanceChangeUseCase } from '../use-cases/decide-attendance-change/decide-attendance-change.usecase.ts';
let f: ChangeFixture;
beforeAll(async () => {
  f = await attendanceChangeFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('ACR-14 an outbox failure rolls back the kind effect, decision, audit and idempotency record', async () => {
  const row = await f.fileChange.execute(changeActor(f), changeInput(f));
  const [existing] = await f.h.owner`SELECT id FROM outbox WHERE aggregate_id=${row.id}`;
  const collision = existing?.id as string;
  const effects = await effectCount(f);
  const actor = changeActor(f, row.id, f.owner);
  const useCase = new DecideAttendanceChangeUseCase(
    createAttendanceChangeTransactions(f.db, { newId: () => collision }, f.kinds),
    f.clock,
    f.kinds,
  );
  await expect(useCase.execute(actor, { decision: 'APPROVED', revision: 0 })).rejects.toThrow(
    'ATTENDANCE_CHANGE_PERSISTENCE_FAILED',
  );
  expect(
    await f.h.owner`SELECT status,revision FROM attendance_change_requests WHERE id=${row.id}`,
  ).toEqual([{ status: 'PENDING', revision: 0 }]);
  expect(await changeAudits(f, row.id)).toHaveLength(1);
  expect(await changeEvents(f, row.id)).toHaveLength(1);
  expect(await effectCount(f)).toEqual(effects);
  expect(await f.h.owner`SELECT key FROM idempotency_keys WHERE key=${actor.key}`).toHaveLength(0);
});
it('all active canonical owners receive the request and a second owner can decide it', async () => {
  await f.h.signedInOperator('synthetic-additional-owner@example.test');
  const [user] = await f.h
    .owner`SELECT id FROM "user" WHERE email='synthetic-additional-owner@example.test'`;
  const ownerId = user?.id as string;
  const membership = leaveIds.newId();
  await f.h
    .owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at) VALUES(${f.company},${membership},${ownerId},${OWNER_ROLE_ID},'global','COMPANY',${f.company},'2026-01-01')`;
  const row = await f.fileChange.execute(changeActor(f), changeInput(f));
  const [notice] = await changeEvents(f, row.id);
  expect(
    notice?.payload.notification_recipients.map((r: { user_id: string }) => r.user_id).sort(),
  ).toEqual([f.owner, ownerId].sort());
  expect(
    await f.decideChange.execute(changeActor(f, row.id, ownerId), {
      decision: 'REJECTED',
      revision: 0,
      reason: 'wrong day',
    }),
  ).toMatchObject({ decided_by: ownerId, status: 'REJECTED' });
  await f.h.owner`UPDATE memberships SET ends_at='2026-10-01' WHERE id=${membership}`;
  const next = await f.fileChange.execute(changeActor(f), changeInput(f));
  expect((await changeEvents(f, next.id))[0]?.payload.notification_recipients).toHaveLength(1);
  await expect(
    f.decideChange.execute(changeActor(f, next.id, ownerId), { decision: 'APPROVED', revision: 0 }),
  ).rejects.toThrow('NOT_FOUND');
});
it.each([
  'x'.repeat(256),
  'https://example.invalid',
  'token',
  '+96512345678',
  '1234',
  'safe reason',
])('sends only safe decision text and never puts a reason in event facts', async (reason) => {
  const row = await f.fileChange.execute(changeActor(f), changeInput(f));
  await f.decideChange.execute(changeActor(f, row.id, f.owner), {
    decision: 'REJECTED',
    revision: 0,
    reason,
  });
  const event = (await changeEvents(f, row.id)).at(-1);
  if (!event) throw new Error('MISSING_DECISION_EVENT');
  const { notification_recipients: recipients, ...facts } = event.payload;
  expect(facts).not.toHaveProperty('reason');
  expect(facts).not.toHaveProperty('decision_reason');
  expect(recipients[0].safe_parameters.at(-1)).toMatchObject({
    name: 'reason',
    value: reason === 'safe reason' ? reason : '-',
  });
  for (const audit of await changeAudits(f, row.id)) {
    expect(audit.after).not.toHaveProperty('reason');
    expect(audit.after).not.toHaveProperty('decision_reason');
  }
});
