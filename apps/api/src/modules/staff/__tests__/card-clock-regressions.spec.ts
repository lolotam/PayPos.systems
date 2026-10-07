import { afterAll, beforeAll, expect, it } from 'vitest';
import { IdempotencyKeyReusedError, type TenantWrappers } from '@pospay/db';
import { sql } from 'drizzle-orm';
import {
  CARD_CODE,
  cardHash,
  clockByCardFixture,
  type CardFixture,
} from './clock-by-card.fixture.ts';
import { createCardClockTransactions } from '../persistence/card-clock-transactions.ts';
import { ClockByCard } from '../use-cases/clock-by-card/clock-by-card.ts';
import { readEmployeeCards } from '../queries/employee-cards.query.ts';
import { createEmployeeCardAccess } from '../persistence/employee-card-access.adapter.ts';

let f: CardFixture;
beforeAll(async () => {
  f = await clockByCardFixture();
});
afterAll(async () => {
  await f?.close();
});

it('retains the original QR branch on close and MISSED_OUT events and audits', async () => {
  await f.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.companyId},${f.ids.newId()},${f.businessId},${f.employeeId},${f.otherBranch},'2026-01-01')`;
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${f.companyId},${f.ids.newId()},${f.userId},id,'global','BRANCH',${f.otherBranch},'2026-01-01' FROM roles WHERE company_id IS NULL AND code='staff'`;
  f.setNow(new Date('2026-10-05T08:00:00Z'));
  const opened = await (await f.prepare()).execute();
  f.setNow(new Date('2026-10-05T09:00:00Z'));
  const closed = await (await f.prepare(f.scan(f.otherBranch))).execute();
  expect(closed.session_id).toBe(opened.session_id);
  f.setNow(new Date('2026-10-05T10:00:00Z'));
  const next = await (await f.prepare()).execute();
  f.setNow(new Date('2026-10-06T02:00:00Z'));
  const missed = await (await f.prepare(f.scan(f.otherBranch))).execute();
  expect(missed.missed_session_id).toBe(next.session_id);
  const events = await f.owner`SELECT event_type,payload FROM outbox WHERE company_id=${f.companyId}
    AND event_type IN ('AttendanceClockedOut','AttendanceMissedOut')`;
  expect(events).toHaveLength(2);
  for (const row of events) expect(row.payload.branch_id).toBe(f.branchId);
  const audits = await f.owner`SELECT after FROM audit_log WHERE company_id=${f.companyId}
    AND entity='attendance_session' AND action IN ('clocked_out','missed_out')`;
  for (const row of audits) expect(row.after.branch_id).toBe(f.branchId);
  const [old] =
    await f.owner`SELECT clock_out,working_date::text FROM attendance_sessions WHERE company_id=${f.companyId} AND id=${next.session_id}`;
  expect(old).toMatchObject({
    clock_out: new Date('2026-10-06T02:00:00Z'),
    working_date: '2026-10-05',
  });
});

it('serializes simultaneous QR and card scans and shares dedupe in both directions', async () => {
  f.setNow(new Date('2026-10-06T03:00:00Z'));
  const personal = await f.prepare();
  const results = await Promise.all([
    personal.execute(),
    f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem()),
  ]);
  expect(results[0]).toEqual(results[1]);
  f.setNow(new Date('2026-10-06T04:00:00Z'));
  const qr = await (await f.prepare()).execute();
  f.setNow(new Date('2026-10-06T04:01:00Z'));
  expect(await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem())).toEqual(qr);
  const [count] =
    await f.owner`SELECT count(*)::int AS count FROM attendance_sessions WHERE company_id=${f.companyId} AND status='OPEN'`;
  expect(count?.count).toBeLessThanOrEqual(1);
});

it('rolls back movement, state, audit, outbox and idempotency together', async () => {
  f.setNow(new Date('2026-10-06T05:00:00Z'));
  const before = await snapshot();
  const wrappers: TenantWrappers = {
    ...f.database,
    withTenant: (company, work, options) =>
      f.database.withTenant(
        company,
        async (tx) => {
          await work(tx);
          throw new Error('SYNTHETIC_ROLLBACK');
        },
        options,
      ),
  };
  const clock = new ClockByCard(
    createCardClockTransactions(wrappers, f.ids, cardHash, f.auth.staff),
    f.clock,
    f.ids,
  );
  await expect(clock.execute(f.scope, { card_code: CARD_CODE }, f.idem())).rejects.toThrow(
    'SYNTHETIC_ROLLBACK',
  );
  expect(await snapshot()).toEqual(before);
});

it('binds idempotency to device and operator and rechecks login and revoked devices', async () => {
  f.setNow(new Date('2026-10-06T06:00:00Z'));
  const idem = f.idem();
  const accepted = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, idem);
  await expect(
    f.clockByCard.execute(
      { ...f.scope, branchId: f.otherBranch, deviceId: f.otherDeviceId },
      { card_code: CARD_CODE },
      idem,
    ),
  ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  await f.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,starts_at)
    SELECT ${f.companyId},${f.ids.newId()},${f.userId},id,'global','BRANCH',${f.branchId},'2026-01-01' FROM roles WHERE company_id IS NULL AND code='cashier'`;
  await expect(
    f.clockByCard.execute({ ...f.scope, operatorId: f.userId }, { card_code: CARD_CODE }, idem),
  ).rejects.toBeInstanceOf(IdempotencyKeyReusedError);
  expect(await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, idem)).toEqual(accepted);
  await f.owner`UPDATE memberships SET ends_at='2026-10-06T06:00:00Z' WHERE company_id=${f.companyId} AND user_id=${f.operatorId} AND role_id IN (SELECT id FROM roles WHERE code='cashier')`;
  await expect(
    f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem()),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.owner`UPDATE devices SET status='REVOKED',token_hash=NULL,token_expires_at=NULL,revoked_at=clock_timestamp() WHERE company_id=${f.companyId} AND id=${f.scope.deviceId}`;
  await expect(
    f.clockByCard.execute({ ...f.scope, operatorId: f.userId }, { card_code: CARD_CODE }, f.idem()),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('projects only the display suffix and uses an employee index for the admin query', async () => {
  const employees = Array.from({ length: 200 }, (_, index) => ({
    company_id: f.companyId,
    id: f.ids.newId(),
    business_id: f.businessId,
    primary_branch_id: f.branchId,
    name_en: `Synthetic plan employee ${index}`,
    role_code: 'staff',
    hire_date: '2026-01-01',
  }));
  await f.owner`INSERT INTO employees ${f.owner(employees)}`;
  const cards = employees.map((employee, index) => ({
    company_id: f.companyId,
    id: f.ids.newId(),
    business_id: f.businessId,
    employee_id: employee.id,
    card_code_hash: cardHash(f.companyId, `SYNTHETIC-PLAN-${index}`),
    card_code_suffix: 'PLAN',
    issued_at: f.clock.now(),
    issued_by: f.operatorId,
  }));
  await f.owner`INSERT INTO employee_cards ${f.owner(cards)}`;
  await f.owner`ANALYZE employee_cards`;
  await f.database.withTenant(f.companyId, async (tx) => {
    const decision = await createEmployeeCardAccess().read(
      tx,
      f.companyId,
      f.operatorId,
      f.businessId,
    );
    const view = await readEmployeeCards(tx, f.companyId, f.businessId, f.employeeId, decision);
    expect(view).toMatchObject({ active: { card_code_suffix: '0001' }, can_manage: true });
    expect(JSON.stringify(view)).not.toContain(CARD_CODE);
    await tx.execute(sql`SET LOCAL enable_seqscan=off`);
    const plan =
      await tx.execute(sql`EXPLAIN ANALYZE SELECT id,employee_id,card_code_suffix,issued_at,revoked_at FROM employee_cards
      WHERE company_id=${f.companyId} AND business_id=${f.businessId} AND employee_id=${f.employeeId} AND revoked_at IS NULL`);
    expect(JSON.stringify(plan)).toMatch(
      /Index Scan using employee_cards_(active_employee_key|employee_history_idx)/,
    );
    expect(JSON.stringify(plan)).toContain('Index Cond: ((company_id');
    expect(JSON.stringify(plan)).toContain('AND (employee_id');
  });
});

async function snapshot() {
  const data: unknown[] = [];
  for (const table of [
    'attendance_sessions',
    'attendance_states',
    'attendance_exceptions',
    'audit_log',
    'outbox',
    'idempotency_keys',
  ]) {
    const order = table === 'idempotency_keys' ? 'scope_type,scope_id,operation,key' : 'id';
    data.push(
      await f.owner.unsafe(`SELECT * FROM ${table} WHERE company_id=$1 ORDER BY ${order}`, [
        f.companyId,
      ]),
    );
  }
  return data;
}
