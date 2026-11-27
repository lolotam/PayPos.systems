import { SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { createEndMembershipTransactions } from '../persistence/end-membership-transactions.ts';
import { createGrantInvalidator } from '../persistence/grant-invalidator.ts';
import { EndMembership } from '../use-cases/end-membership/end-membership.ts';

const ids = systemUuidV7();
let h: Harness;
let ownerCookie: string;
let ownerId: string;
let memberId: string;
let company: string;
let business: string;

const roleId = (code: string) => SYSTEM_ROLES.find((r) => r.code === code)?.id ?? '';

async function userIdOf(email: string): Promise<string> {
  const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${email}`;
  return String(row?.['id'] ?? '');
}

async function addMembership(startsAt: string): Promise<string> {
  const id = ids.newId();
  await h.owner`
    INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id, starts_at)
    VALUES (${company}, ${id}, ${memberId}, ${roleId('accountant')}, 'global', 'COMPANY', ${company}, ${startsAt}::timestamptz)`;
  return id;
}

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
  ownerCookie = await h.signedInOperator('g2-clock-owner@example.test');
  await h.signedInOperator('g2-clock-member@example.test');
  ownerId = await userIdOf('g2-clock-owner@example.test');
  memberId = await userIdOf('g2-clock-member@example.test');
  company = await h.onboard(ownerCookie, 'G2 Clock Lock Company');
  business = (
    await h.send('POST', '/v1/businesses', {
      cookie: ownerCookie,
      company,
      key: 'g2-clock-business',
      body: { vertical_type: 'salon', name_en: 'Clock Salon' },
    })
  ).body['id'] as string;
  expect(business).toBeTruthy();
});

afterAll(async () => {
  await h?.close();
});

async function waitForLockWaiter(): Promise<void> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const [row] = await h.owner`
      SELECT count(*)::int AS n FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE NOT l.granted AND a.datname = current_database()`;
    if ((row?.['n'] ?? 0) >= 1) return;
    if (Date.now() > deadline) throw new Error('LOCK_WAITER_NOT_SEEN');
  }
}

it('samples the clock after acquiring FOR UPDATE so a concurrent waiter observes the winner timestamp and avoids a second audit (#1315)', async () => {
  const membershipId = await addMembership('2026-11-28T09:00:00.000Z');
  const firstNow = new Date('2026-11-28T10:00:05.000Z');
  const secondAfterLockNow = new Date('2026-11-28T10:00:06.000Z');
  const secondPreLockNow = new Date('2026-11-28T10:00:01.000Z');

  let enteredCommit!: () => void;
  const firstAtBarrier = new Promise<void>((resolve) => {
    enteredCommit = resolve;
  });
  let releaseFirst!: () => void;
  const allowFirstCommit = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });

  const first = new EndMembership({
    transactions: createEndMembershipTransactions(h.app.get(DATABASE), ids, async () => {
      enteredCommit();
      await allowFirstCommit;
    }),
    invalidator: createGrantInvalidator(h.redis),
    clock: { now: () => firstNow },
  });

  let secondClock = secondPreLockNow;
  const second = new EndMembership({
    transactions: createEndMembershipTransactions(h.app.get(DATABASE), ids),
    invalidator: createGrantInvalidator(h.redis),
    clock: { now: () => secondClock },
  });

  const cmd = { companyId: company, actorUserId: ownerId, membershipId };
  const p1 = first.execute(cmd);
  await firstAtBarrier;

  const p2 = second.execute(cmd);
  await waitForLockWaiter();
  // بعد انتظار القفل وقت التاني بقى أكبر من وقت الفائز، مع إنه كان أصغر قبل الدخول.
  secondClock = secondAfterLockNow;
  releaseFirst();

  const [r1, r2] = await Promise.all([p1, p2]);
  expect(r1.ends_at).toBe(firstNow.toISOString());
  expect(r2.ends_at).toBe(firstNow.toISOString());

  const audits = await h.owner`
    SELECT after FROM audit_log
    WHERE company_id = ${company} AND action = 'membership.ended' AND entity_id = ${membershipId}`;
  expect(audits).toEqual([{ after: { ends_at: firstNow.toISOString() } }]);
});

it('applies +1 ms floor only for same-millisecond starts_at and never fabricates a future ends_at (#1315)', async () => {
  const instant = '2026-11-28T12:00:00.000Z';
  const sameMsId = await addMembership(instant);
  const laterMsId = await addMembership(instant);
  const futureId = await addMembership('2026-11-29T12:00:00.000Z');

  const endAt = async (membershipId: string, nowIso: string) =>
    new EndMembership({
      transactions: createEndMembershipTransactions(h.app.get(DATABASE), ids),
      invalidator: createGrantInvalidator(h.redis),
      clock: { now: () => new Date(nowIso) },
    }).execute({ companyId: company, actorUserId: ownerId, membershipId });

  expect((await endAt(sameMsId, instant)).ends_at).toBe('2026-11-28T12:00:00.001Z');
  expect((await endAt(laterMsId, '2026-11-28T12:00:00.250Z')).ends_at).toBe(
    '2026-11-28T12:00:00.250Z',
  );
  // لو starts_at في المستقبل، ما يرفعش ends_at للمستقبل ويفشل قيد memberships_window بدل الكتمان.
  await expect(endAt(futureId, instant)).rejects.toThrow();
});
