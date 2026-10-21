import { afterAll, beforeAll, expect, it } from 'vitest';
import { serviceSessionDayPage, type RecordServiceSessionInput } from '@pospay/contracts';
import { sql } from 'drizzle-orm';
import { ordersDayQuery, ordersLinePerformers } from '../orders.module.ts';
import { branchDayServiceSessionsStatement } from '../queries/branch-day-service-sessions.query.ts';
import { ChangeLinePerformersUseCase } from '../use-cases/change-line-performers/change-line-performers.usecase.ts';
import { cancelServiceLine } from '../../../../../../packages/db/test/service-line-cancellation.ts';
import { seedPriceEdit } from './line-edit.helpers.ts';
import { ids, interceptDatabase, must, sessionFixture, type SessionFixture } from './session.fixture.ts';

let f: SessionFixture;
beforeAll(async () => { f = await sessionFixture(); });
afterAll(async () => { await f?.close(); });
const scope = () => ({ ...f.context(), userId: f.ownerId });
const read = (date: string, extra = {}) => ordersDayQuery(f.db).execute(scope(), { date, limit: 20, ...extra });

it('projects saved multi-line/shared-service snapshots and no phone, limits or commission data', async () => {
  const input: RecordServiceSessionInput = { ...f.body(), lines: [
    { ...f.line(), performers: [{ employee_id: must(f.employees[2]), share_bps: 7000 }, { employee_id: must(f.employees[0]), share_bps: 3000 }] },
    f.line(), f.line(must(f.services[2]), '0.000'),
  ] };
  const saved = await f.create.execute({ ...f.context(), input });
  await f.h.owner`UPDATE services SET name_en='Changed catalog name' WHERE company_id=${f.company} AND id=${must(f.services[0])}`;
  await f.h.owner`UPDATE customers SET name='Changed customer name' WHERE company_id=${f.company} AND id=${f.customer}`;
  const page = serviceSessionDayPage.parse(await read('2026-10-14'));
  const visit = must(page.items.find((row) => row.id === saved.session.id));
  expect(visit.customer).toEqual({ id: f.customer, name: 'Synthetic customer' });
  expect(visit.lines.map((line) => line.ordinal)).toEqual([1, 2, 3]);
  expect(visit.lines[0]?.name_en).toBe('Synthetic service 0');
  expect(visit.lines[0]?.performers.map((p) => p.employee_id)).toEqual([f.employees[2], f.employees[0]]);
  expect(visit.lines[0]?.has_performer_warning).toBe(true);
  expect(visit.lines[2]?.net).toBe('0.000');
  for (const privateField of ['phone', 'user_id', 'membership', 'limit_source', 'rule_snapshot', 'counts_snapshot', 'total_net', 'input_index']) {
    expect(JSON.stringify(visit)).not.toContain(privateField);
  }
  expect(await read('2000-01-01')).toEqual({ items: [], next_cursor: null });
});

it('late-only agrees with the badge after a first late append, without changing the on-time header', async () => {
  const onTime = await f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-10-15T08:00:00.000Z' } });
  expect((await read('2026-10-15', { late: 'true' })).items).toEqual([]);
  f.setAt(new Date('2026-10-16T08:00:00Z'));
  await f.append.execute({ ...f.context(), sessionId: onTime.session.id, input: { lines: [f.line()] } });
  await f.append.execute({ ...f.context(), sessionId: onTime.session.id, input: { lines: [f.line()] } });
  const page = await read('2026-10-15', { late: 'true' });
  expect(page.items.map((item) => item.id)).toEqual([onTime.session.id]);
  expect(page.items[0]?.late).toBe(true);
  expect(page.items[0]?.lines.map((line) => line.late)).toEqual([false, true, true]);
  const [header] = await f.h.owner`SELECT late FROM service_sessions WHERE company_id=${f.company} AND id=${onTime.session.id}`;
  expect(header?.['late']).toBe(false);
  f.setAt(new Date('2026-10-17T08:00:00Z'));
  expect(await read('2026-10-15', { late: 'true' })).toEqual(page);
});

it('cursor pages preserve microseconds and UUID ties without splitting a visit', async () => {
  const saved: string[] = [];
  f.setAt(new Date('2026-10-18T08:00:00Z'));
  for (let n = 0; n < 5; n++) {
    const result = await f.create.execute({ ...f.context(), input: { ...f.body([f.line(), f.line()]), occurred_at: '2026-10-17T08:00:00Z' } });
    saved.push(result.session.id);
    await f.h.owner`UPDATE service_sessions SET occurred_at=${n < 3 ? '2026-10-17T08:00:00.123456Z' : '2026-10-17T08:00:00.123455Z'}::text::timestamptz
      WHERE company_id=${f.company} AND id=${result.session.id}`;
  }
  const expected = [...saved.slice(0, 3).sort().reverse(), ...saved.slice(3).sort().reverse()];
  const seen: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await read('2026-10-17', { limit: 1, ...(cursor === undefined ? {} : { cursor }) });
    expect(page.items[0]?.lines).toHaveLength(2);
    expect(seen).not.toContain(page.items[0]?.id);
    expect(seen.length).toBeLessThan(saved.length);
    seen.push(...page.items.map((item) => item.id));
    if (page.next_cursor !== null) {
      const decoded = JSON.parse(Buffer.from(page.next_cursor, 'base64url').toString('utf8')) as { at: string };
      expect(decoded.at).toMatch(/\.12345[56]Z$/);
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  expect(seen).toEqual(expected);
  const first = await read('2026-10-17', { limit: 1 });
  for (const change of [{ date: '2026-10-16' }, { late: 'true' }]) {
    await expect(read('2026-10-17', { cursor: first.next_cursor, ...change })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  }
  await expect(ordersDayQuery(f.db).execute({ ...scope(), branchId: f.secondBranch }, { date: '2026-10-17', limit: 1, cursor: must(first.next_cursor) }))
    .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  for (const limit of [20, 100]) expect((await read('2026-10-17', { limit })).items).toHaveLength(5);
});

it('uses stored business dates at local midnight and reads historical days', async () => {
  await f.h.owner`UPDATE businesses SET timezone='Pacific/Auckland' WHERE company_id=${f.company} AND id=${f.business}`;
  f.setAt(new Date('2026-10-19T11:00:00Z'));
  const saved = await f.create.execute({ ...f.context(), input: { ...f.body(), occurred_at: '2026-10-18T11:30:00Z' } });
  expect(saved.session.business_date).toBe('2026-10-19');
  await f.h.owner`UPDATE businesses SET timezone='UTC' WHERE company_id=${f.company} AND id=${f.business}`;
  expect((await read('2026-10-19')).items[0]?.business_timezone).toBe('Pacific/Auckland');
  f.setAt(new Date('2027-03-01T08:00:00Z'));
  expect((await read('2026-10-19')).items.map((row) => row.id)).toContain(saved.session.id);
});

it('has fixed authorization reads and one list statement regardless of page size', async () => {
  const statements: string[] = [];
  const query = ordersDayQuery(interceptDatabase(f.db, async (statement) => { statements.push(statement); }));
  await query.execute(scope(), { date: '2026-10-17', limit: 1 });
  const first = [...statements]; statements.length = 0;
  await query.execute(scope(), { date: '2026-10-17', limit: 100 });
  expect(statements).toEqual(first);
  expect(first.filter((statement) => statement.startsWith('WITH candidates'))).toHaveLength(1);
  // فحص الشركة من غير قفل جوه readAccessTransaction ضمن قراءات الإذن الثابتة.
  expect(first).toHaveLength(8);
});

it('keeps query RLS outside context, after rollback and against another tenant scope', async () => {
  const statement = branchDayServiceSessionsStatement(scope(), { date: '2026-10-17', limit: 20 });
  await expect(f.db.withTenant(f.company, async (tx) => { await tx.execute(statement); throw new Error('fixture rollback'); })).rejects.toThrow('fixture rollback');
  const rows = await f.db.withUser(f.ownerId, (tx) => tx.execute(statement));
  expect(rows).toHaveLength(0);
  const foreign = await f.db.withTenant(f.otherCompany, (tx) => tx.execute(statement));
  expect(foreign).toHaveLength(0);
  const visible = await f.db.withTenant(f.company, (tx) => tx.execute(sql`SELECT count(*)::int AS n FROM service_lines WHERE business_id=${f.secondBusiness}`));
  expect(visible[0]?.['n']).toBe(0);
});

it('projects the numeric money maximum losslessly as a KWD string', async () => {
  f.setAt(new Date('2027-03-01T08:00:00Z'));
  const saved = await f.create.execute({ ...f.context(undefined, f.ownerId),
    input: { ...f.body([f.line(must(f.services[0]), '99999999999.999')]), occurred_at: '2027-03-01T08:00:00Z' } });
  const page = await read('2027-03-01');
  expect(page.items.find((visit) => visit.id === saved.session.id)?.lines[0]).toMatchObject({
    price: '99999999999.999', net: '99999999999.999', discount: '0.000', list_price: '25.000',
  });
});

it('derives edited from a history row and keeps price history off the day list', async () => {
  f.setAt(new Date('2026-10-21T08:00:00Z'));
  const saved = await f.create.execute({ ...f.context(), input: { ...f.body([f.line(), f.line()]), occurred_at: '2026-10-20T08:00:00.000Z' } });
  const edited = must(saved.session.lines[0]).id;
  await seedPriceEdit(f, { lineId: edited, revision: 2 });
  const visit = must(serviceSessionDayPage.parse(await read('2026-10-20')).items.find((row) => row.id === saved.session.id));
  expect(visit.lines.find((line) => line.id === edited)?.edited).toBe(true);
  expect(visit.lines.find((line) => line.id !== edited)?.edited).toBe(false);
  const payload = JSON.stringify(visit);
  for (const hidden of ['previous_price', 'previous_discount', 'previous_net', 'new_price', 'new_discount', 'new_net',
    'editor_label', 'editor_name', 'editor_role', 'changed_at', 'reason']) expect(payload).not.toContain(hidden);
});

it('projects cancelled_at from the history row and omits it on an active sibling', async () => {
  f.setAt(new Date('2026-10-22T08:00:00Z'));
  const saved = await f.create.execute({ ...f.context(), input: { ...f.body([f.line(), f.line()]), occurred_at: '2026-10-21T08:00:00.000Z' } });
  const cancelledId = must(saved.session.lines[0]).id;
  const owners = await f.h.owner`SELECT id FROM memberships WHERE company_id=${f.company} AND user_id=${f.ownerId} AND scope_type='COMPANY'`;
  await f.db.withTenant(f.company, (tx) => cancelServiceLine(tx, {
    companyId: f.company, lineId: cancelledId, expectedRevision: 1, cancelledBy: f.ownerId,
    membershipId: must(owners[0])['id'] as string, cancellationId: ids.newId(), reason: 'Synthetic cancel reason',
  }));
  const [stored] = await f.h.owner`SELECT to_char(cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cancelled_at
    FROM service_line_cancellations WHERE company_id=${f.company} AND line_id=${cancelledId}`;
  const visit = must(serviceSessionDayPage.parse(await read('2026-10-21')).items.find((row) => row.id === saved.session.id));
  const cancelled = must(visit.lines.find((line) => line.id === cancelledId));
  const sibling = must(visit.lines.find((line) => line.id !== cancelledId));
  expect(cancelled.status).toBe('CANCELLED');
  expect(cancelled.cancelled_at).toBe(stored?.['cancelled_at']);
  expect(sibling.status).toBe('ACTIVE');
  expect(sibling.cancelled_at).toBeUndefined();
  const linePayload = JSON.stringify(visit.lines);
  for (const hidden of ['Synthetic cancel reason', '+999999998123', 'canceller_name', 'cancelled_by']) {
    expect(linePayload).not.toContain(hidden);
  }
});

it('projects the performer-change mark from the history, omits it on an untouched line and takes the latest change', async () => {
  const change = new ChangeLinePerformersUseCase(ordersLinePerformers(f.db), ids, f.clock);
  // نشاط الكويت بعينه: يوم العلامة بتوقيت النشاط لا بتوقيت UTC.
  await f.h.owner`UPDATE businesses SET timezone='Asia/Kuwait' WHERE company_id=${f.company} AND id=${f.business}`;
  f.setAt(new Date('2026-10-14T08:00:00.000Z'));
  const saved = await f.create.execute({ ...f.context(), input: { ...f.body([f.line(), f.line()]), occurred_at: '2026-10-14T08:00:00.000Z' } });
  const changed = must(saved.session.lines[0]).id;
  const untouched = must(saved.session.lines[1]).id;
  const lines = async () => {
    const visit = must(serviceSessionDayPage.parse(await read('2026-10-14')).items.find((row) => row.id === saved.session.id));
    return { changed: must(visit.lines.find((line) => line.id === changed)), untouched: must(visit.lines.find((line) => line.id === untouched)) };
  };
  f.setAt(new Date('2026-10-15T22:30:00.000Z'));
  await change.execute({ ...f.context(ids.newId(), f.ownerId), sessionId: saved.session.id, lineId: changed,
    input: { performers: [{ employee_id: must(f.employees[1]), share_bps: 10000 }], reason: 'Synthetic performer reason', expected_revision: 1 } });
  // الساعة 01:30 في الكويت من يوم 16، واليوم بتوقيت UTC هو 15، فالتاريخ يثبت توقيت النشاط.
  const first = await lines();
  expect(first.changed.performers_changed_at).toBe('2026-10-16');
  expect(Object.hasOwn(first.untouched, 'performers_changed_at')).toBe(false);
  f.setAt(new Date('2026-10-18T22:30:00.000Z'));
  await change.execute({ ...f.context(ids.newId(), f.ownerId), sessionId: saved.session.id, lineId: changed,
    input: { performers: [{ employee_id: must(f.employees[0]) }], reason: 'Synthetic performer reason again', expected_revision: 2 } });
  const second = await lines();
  expect(second.changed.performers_changed_at).toBe('2026-10-19');
  expect(Object.hasOwn(second.untouched, 'performers_changed_at')).toBe(false);
});
