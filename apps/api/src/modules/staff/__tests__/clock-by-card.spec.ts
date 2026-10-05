import { afterAll, beforeAll, expect, it } from 'vitest';

import {
  CARD_CODE,
  cardHash,
  clockByCardFixture,
  type CardFixture,
} from './clock-by-card.fixture.ts';

const T0 = new Date('2026-10-05T08:00:00.000Z');
let f: CardFixture;

beforeAll(async () => {
  f = await clockByCardFixture();
});
afterAll(async () => {
  await f?.close();
});

const sessions = (companyId = f.companyId) =>
  f.owner`SELECT id,status,source,device_id,operator_id,clock_in,clock_out FROM attendance_sessions
    WHERE company_id=${companyId} AND employee_id=${f.employeeId} ORDER BY clock_in`;

it('clocks in and out by card, recording source, device and operator with audit and outbox', async () => {
  f.setNow(T0);
  const first = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  expect(first).toMatchObject({
    operation: 'CLOCK_IN',
    exceptions: ['NONE'],
    missed_session_id: null,
  });
  const rows = await sessions();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    status: 'OPEN',
    source: 'BARCODE',
    device_id: f.scope.deviceId,
    operator_id: f.scope.operatorId,
  });
  const audit = await f.owner`SELECT action,after FROM audit_log WHERE company_id=${f.companyId}
    AND entity='attendance_session' ORDER BY at`;
  expect(audit.map((row) => row.action)).toContain('clocked_in');
  const outbox =
    await f.owner`SELECT event_type,payload FROM outbox WHERE company_id=${f.companyId} ORDER BY created_at`;
  expect(outbox.map((row) => row.event_type)).toContain('AttendanceClockedIn');
  const leaked =
    await f.owner`SELECT count(*)::int AS count FROM audit_log WHERE after::text LIKE ${'%' + CARD_CODE + '%'}`;
  expect(leaked[0]?.count).toBe(0);
  const leakedOutbox =
    await f.owner`SELECT count(*)::int AS count FROM outbox WHERE payload::text LIKE ${'%' + CARD_CODE + '%'}`;
  expect(leakedOutbox[0]?.count).toBe(0);

  f.setNow(new Date(T0.getTime() + 60 * 60 * 1000));
  const second = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  expect(second.operation).toBe('CLOCK_OUT');
  const closed = await sessions();
  expect(closed).toHaveLength(1);
  expect(closed[0]).toMatchObject({ status: 'CLOSED', source: 'BARCODE' });
});

it('returns the previous accepted result within five minutes and permits the transition at exactly five', async () => {
  f.setNow(new Date(T0.getTime() + 4 * 60 * 60 * 1000));
  const opened = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  expect(opened.operation).toBe('CLOCK_IN');
  f.setNow(new Date(T0.getTime() + 4 * 60 * 60 * 1000 + 4 * 60 * 1000));
  const deduped = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  expect(deduped).toEqual(opened);
  f.setNow(new Date(T0.getTime() + 4 * 60 * 60 * 1000 + 5 * 60 * 1000));
  const transition = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  expect(transition.operation).toBe('CLOCK_OUT');
});

it('shares the five-minute dedupe with the personal passkey path through AttendanceState', async () => {
  f.setNow(new Date(T0.getTime() + 9 * 60 * 60 * 1000));
  const card = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  expect(card.operation).toBe('CLOCK_IN');
  f.setNow(new Date(T0.getTime() + 9 * 60 * 60 * 1000 + 60 * 1000));
  const passkey = await (await f.prepare()).execute();
  expect(passkey).toEqual(card);
});

it('applies the 16h rule through the card: close MISSED_OUT then open a new session', async () => {
  f.setNow(new Date(T0.getTime() + 25 * 60 * 60 * 1000));
  const opened = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem());
  const missed = opened.missed_session_id;
  expect(opened.operation).toBe('CLOCK_IN');
  expect(missed).not.toBeNull();
  const [old] =
    await f.owner`SELECT status,closed_by,out_device_id,out_operator_id FROM attendance_sessions
    WHERE company_id=${f.companyId} AND id=${missed}`;
  expect(old).toMatchObject({
    status: 'MISSED_OUT',
    closed_by: 'MISSED_OUT',
    out_device_id: null,
    out_operator_id: null,
  });
  const openCount = await f.owner`SELECT count(*)::int AS count FROM attendance_sessions
    WHERE company_id=${f.companyId} AND status='OPEN'`;
  expect(openCount[0]?.count).toBe(1);
});

it('answers a revoked card and an unknown card identically, writing nothing', async () => {
  await f.owner`UPDATE employee_cards SET revoked_at=clock_timestamp(),revoked_by=${f.operatorId}
    WHERE company_id=${f.companyId} AND id=${f.cardId}`;
  const before = await sessions();
  await expect(
    f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, f.idem()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    f.clockByCard.execute(f.scope, { card_code: 'UNKNOWN-CARD' }, f.idem()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await sessions()).toEqual(before);
  await f.owner`UPDATE employee_cards SET revoked_at=NULL,revoked_by=NULL
    WHERE company_id=${f.companyId} AND id=${f.cardId}`;
});

it('answers an operator without the permission and a card of another branch as unknown, writing nothing', async () => {
  f.setNow(new Date('2026-10-06T08:00:00.000Z'));
  const before = await sessions();
  await expect(
    f.clockByCard.execute(
      { ...f.scope, operatorId: f.viewerId },
      { card_code: CARD_CODE },
      f.idem(),
    ),
  ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(
    f.clockByCard.execute(
      { ...f.scope, branchId: f.otherBranch, deviceId: f.otherDeviceId },
      { card_code: CARD_CODE },
      f.idem(),
    ),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(
    f.clockByCard.execute(f.scope, { card_code: 'OTHER-COMPANY-CARD' }, f.idem()),
  ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  expect(await sessions()).toEqual(before);
});

it('replays an idempotent card command unchanged and rejects a reused key with a different body', async () => {
  f.setNow(new Date('2026-10-07T08:00:00.000Z'));
  const idem = f.idem();
  const accepted = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, idem);
  const replay = await f.clockByCard.execute(f.scope, { card_code: CARD_CODE }, idem);
  expect(replay).toEqual(accepted);
  const count = await f.owner`SELECT count(*)::int AS count FROM attendance_sessions
    WHERE company_id=${f.companyId} AND clock_in=${f.clock.now().toISOString()}`;
  expect(count[0]?.count).toBe(1);
  await expect(
    f.clockByCard.execute(
      f.scope,
      { card_code: CARD_CODE },
      { ...idem, fingerprint: 'changed-body' },
    ),
  ).rejects.toThrow();
});

it('issues, replaces and revokes a card with audit and idempotent replay', async () => {
  f.setNow(new Date('2026-10-08T08:00:00.000Z'));
  const scope = {
    companyId: f.companyId,
    businessId: f.businessId,
    employeeId: f.employeeId,
    operatorId: f.operatorId,
  };
  const idem = f.idem();
  const issued = await f.issue.execute(scope, 'NEW-CARD-9', idem);
  expect(issued.cardCodeSuffix).toBe('RD-9');
  const replay = await f.issue.execute(scope, 'NEW-CARD-9', idem);
  expect(replay).toEqual(issued);
  const [active] =
    await f.owner`SELECT id,card_code_hash,card_code_suffix,revoked_at FROM employee_cards
    WHERE company_id=${f.companyId} AND employee_id=${f.employeeId} AND revoked_at IS NULL`;
  expect(active).toMatchObject({
    card_code_hash: cardHash(f.companyId, 'NEW-CARD-9'),
    card_code_suffix: 'RD-9',
  });
  f.setNow(new Date('2026-10-08T08:30:00.000Z'));
  const revoked = await f.revoke.execute(scope, issued.id, f.idem());
  expect(revoked.revokedAt).not.toBeNull();
  expect(revoked.issuedAt).toBe(issued.issuedAt);
  const activeAfter = await f.owner`SELECT count(*)::int AS count FROM employee_cards
    WHERE company_id=${f.companyId} AND employee_id=${f.employeeId} AND revoked_at IS NULL`;
  expect(activeAfter[0]?.count).toBe(0);
  const actions = await f.owner`SELECT action FROM audit_log WHERE company_id=${f.companyId}
    AND entity='employee_card' ORDER BY at`;
  expect(actions.map((row) => row.action)).toEqual(expect.arrayContaining(['issued', 'revoked']));
});
