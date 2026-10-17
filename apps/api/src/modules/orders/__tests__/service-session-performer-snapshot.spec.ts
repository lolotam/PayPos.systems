import { afterAll, beforeAll, expect, it } from 'vitest';
import { sessionFixture, must, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
const link = (employee: string | undefined, userId: string | null) =>
  f.h.owner`UPDATE employees SET user_id=${userId} WHERE company_id=${f.company} AND id=${must(employee)}`;
const performerRows = (sessionId: string) => f.h.owner`SELECT p.employee_id,p.linked_user_id,p.linked_user_snapshotted FROM line_performers p
  JOIN service_lines l ON l.company_id=p.company_id AND l.id=p.line_id WHERE l.session_id=${sessionId} ORDER BY l.ordinal,p.performer_ordinal`;
const twoPerformers = () => ({ ...f.line(), performers: [{ employee_id: must(f.employees[0]) }, { employee_id: must(f.employees[1]) }] });

it('record stores the performers linked user at recording time, and true for an unlinked one', async () => {
  await link(f.employees[0], f.ownerId);
  const first = await f.create.execute({ ...f.context(), input: f.body([twoPerformers()]) }).finally(() => link(f.employees[0], null));
  expect(await performerRows(first.session.id)).toEqual([
    { employee_id: must(f.employees[0]), linked_user_id: f.ownerId, linked_user_snapshotted: true },
    { employee_id: must(f.employees[1]), linked_user_id: null, linked_user_snapshotted: true },
  ]);
});

it('append snapshots its own performers at append time and leaves the earlier rows untouched', async () => {
  const first = await f.create.execute({ ...f.context(), input: f.body([f.line()]) });
  await link(f.employees[1], f.ownerId);
  const added = await f.append
    .execute({ ...f.context(), sessionId: first.session.id, input: { lines: [{ ...f.line(), performers: [{ employee_id: must(f.employees[1]) }] }] } })
    .finally(() => link(f.employees[1], null));
  expect(await performerRows(first.session.id)).toEqual([
    { employee_id: must(f.employees[0]), linked_user_id: null, linked_user_snapshotted: true },
    { employee_id: must(f.employees[1]), linked_user_id: f.ownerId, linked_user_snapshotted: true },
  ]);
  expect(added.added_lines).toHaveLength(1);
});

it('never returns the linked user in the response or the outbox payload', async () => {
  await link(f.employees[0], f.ownerId);
  const first = await f.create.execute({ ...f.context(), input: f.body([f.line()]) }).finally(() => link(f.employees[0], null));
  expect(JSON.stringify(first)).not.toContain(f.ownerId);
  const events = await f.h.owner`SELECT payload::text AS payload FROM outbox WHERE aggregate_id=${first.session.id}`;
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((event) => !String(event['payload']).includes(f.ownerId))).toBe(true);
});
