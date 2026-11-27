import postgres from 'postgres';
import { OWNER_ROLE_ID, SYSTEM_ROLES } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import type { StaleInvitationInput } from '../ports/member-invitations.port.ts';
import { createMemberInvitationTransactions } from '../persistence/member-invitation-transactions.ts';

// ترتيب العمليات تحت قفل صف الدعوة (G1، E1): الإتمام والتخلّي عن دعوة قديمة يتنافسوا على نفس
// القفل، والسلطة بتتقري بعده — والقفل بيتفك في كل الأحوال حتى لو الاختبار فشل في النص.
const ids = systemUuidV7();
let h: Harness;
// اتصال مستقل للحاجز: h.owner اتصال واحد، ومعاملة ماسكة القفل فيه كانت هتوقف قراءة المستنيين.
let locker: postgres.Sql;
const ownerA = { email: 'g1lk-owner-a@example.test', cookie: '', userId: '' };
const ownerB = { email: 'g1lk-owner-b@example.test', cookie: '', userId: '' };

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true });
  locker = postgres(h.ownerUrl, { max: 2, onnotice: () => undefined });
  for (const who of [ownerA, ownerB]) {
    who.cookie = await h.signedInOperator(who.email);
    const [row] = await h.owner`SELECT id FROM "user" WHERE email = ${who.email}`;
    who.userId = String(row?.['id']);
  }
});

afterAll(async () => {
  await locker?.end();
  await h?.close();
});

const transactions = () => createMemberInvitationTransactions(h.app.get(DATABASE), ids);
const body = (company: string, email: string, extra: object = {}) => ({
  email,
  name: 'Abandoned',
  role: 'accountant',
  scope: { type: 'COMPANY', id: company },
  email_confirmed: true,
  ...extra,
});
const invite = (who: { cookie: string }, company: string, email: string, extra: object = {}) =>
  h.send('POST', '/v1/memberships/invitations', {
    cookie: who.cookie,
    company,
    body: body(company, email, extra),
  });

/** شركة فيها المالكين A وB: A هو اللي بيفتح الدعوات العالقة وB المالك الحالي اللي بيعيد الدعوة بعدين. */
async function companyWithTwoOwners(name: string): Promise<string> {
  const company = await h.onboard(ownerA.cookie, name);
  const role = SYSTEM_ROLES.find((r) => r.code === 'owner')?.id ?? OWNER_ROLE_ID;
  await h.owner`
    INSERT INTO memberships (company_id, id, user_id, role_id, role_owner_key, scope_type, scope_id)
    VALUES (${company}, ${ids.newId()}, ${ownerB.userId}, ${role}, 'global', 'COMPANY', ${company})`;
  return company;
}

const denyInvitations = async (company: string, userId: string) => {
  const [membership] = await h.owner`
    SELECT id FROM memberships WHERE company_id = ${company} AND user_id = ${userId}
      AND role_id = ${OWNER_ROLE_ID}::uuid`;
  await h.owner`
    INSERT INTO permission_overrides (company_id, id, membership_id, permission_code, effect,
      scope_type, scope_id, reason, granted_by)
    VALUES (${company}, ${ids.newId()}, ${membership?.['id']},
      'manage:memberships:company', 'DENY', 'COMPANY', ${company}, 'test', ${userId})`;
};

/** دعوة A اللي وقفت بعد إنشاء الحساب بالخطوات الحقيقية، قبل الإتمام. */
async function stuckAfterAccount(company: string, email: string) {
  const opened = await transactions().open({
    companyId: company,
    actorUserId: ownerA.userId,
    invitationId: ids.newId(),
    emailHash: h.auth.members.hashEmail(email),
    roleCode: 'accountant',
    scope: { type: 'COMPANY', id: company },
    additionalAssignments: [],
    now: systemClock.now(),
  });
  if (!('invitationId' in opened)) throw new Error('open refused');
  const account = await h.auth.members.createInvitedMember({
    operationId: opened.invitationId,
    companyId: company,
    email,
    name: 'Stuck',
  });
  if (!account.createdByInvitation) throw new Error('account not created');
  return { invitationId: opened.invitationId, userId: account.userId };
}

const ageInvitation = (company: string, invitationId: string) =>
  h.owner`UPDATE member_invitations SET created_at = now() - interval '1 hour'
    WHERE company_id = ${company} AND id = ${invitationId}`;
const accountsOf = (email: string) => h.owner`SELECT id FROM "user" WHERE email = ${email}`;
const stateOf = async (company: string, id: string) =>
  (
    await h.owner`SELECT state FROM member_invitations WHERE company_id = ${company} AND id = ${id}`
  )[0]?.['state'];

// عدد الـ backends المستنية قفل في الداتابيز دي — الحاجز اللي الاختبار بيقف عليه.
const waitForWaiters = (count: number) =>
  vi.waitFor(
    async () => {
      const [row] = await h.owner`
        SELECT count(*)::int AS waiting FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      expect(Number(row?.['waiting'])).toBeGreaterThanOrEqual(count);
    },
    { timeout: 8_000, interval: 25 },
  );

const completeInput = (company: string, invitationId: string, userId: string) => ({
  companyId: company,
  actorUserId: ownerA.userId,
  invitationId,
  membershipId: ids.newId(),
  userId,
  additionalAssignments: [],
  additionalMembershipIds: [],
  permissionOverrides: [],
  buildEvent: (row: { id: string }, membership: { membershipId: string }, user: string) => ({
    aggregateType: 'member_invitation',
    aggregateId: row.id,
    eventType: 'MemberInvited',
    payload: { invitation_id: row.id, user_id: user, membership_id: membership.membershipId },
  }),
  buildAudit: () => [],
  now: systemClock.now(),
});

async function holdInvitationLock(company: string, invitationId: string) {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  let taken: () => void = () => undefined;
  const lockTaken = new Promise<void>((resolve) => (taken = resolve));
  const holder = locker.begin(async (tx) => {
    await tx`SELECT 1 FROM member_invitations WHERE company_id = ${company} AND id = ${invitationId} FOR UPDATE`;
    taken();
    await held;
  });
  await lockTaken;
  return { release, holder };
}

/** مدخلات التخلّي عن دعوة قديمة — المالك الحالي B هو اللي بيطلب، والنافذة بتعدّت قبل الآن. */
const abandonStaleInput = (
  company: string,
  invitationId: string,
): StaleInvitationInput => ({
  companyId: company,
  actorUserId: ownerB.userId,
  invitationId,
  roleCode: 'accountant',
  scope: { type: 'COMPANY', id: company },
  additionalAssignments: [],
  staleBefore: new Date(Date.now() - 60_000),
});

describe('abandoning blocks completion while it runs, and the order is decided by the row lock', () => {
  it('a completion queued first wins and the abandon is refused (membership exists)', async () => {
    const company = await companyWithTwoOwners('G1LK Lock Complete First');
    const stuck = await stuckAfterAccount(company, 'lock-complete-first@example.test');
    await ageInvitation(company, stuck.invitationId);
    const lock = await holdInvitationLock(company, stuck.invitationId);
    try {
      const completing = transactions().complete(
        completeInput(company, stuck.invitationId, stuck.userId),
      );
      await waitForWaiters(1);
      const abandoning = transactions().abandonStale(
        abandonStaleInput(company, stuck.invitationId),
      );
      await waitForWaiters(2);
      lock.release();
      await lock.holder;
      expect(await completing).toMatchObject({ done: true, alreadyComplete: false });
      expect(await abandoning).toBe(false);
      expect(await stateOf(company, stuck.invitationId)).toBe('PENDING');
    } finally {
      // القفل بيتفك في كل الأحوال: اختبار فاشل ما ينفعش يسيب صف الدعوة مقفول على الملف كله.
      lock.release();
      await lock.holder.catch(() => undefined);
    }
  });

  it('an abandon queued first wins and the completion is refused with no membership', async () => {
    const company = await companyWithTwoOwners('G1LK Lock Abandon First');
    const stuck = await stuckAfterAccount(company, 'lock-abandon-first@example.test');
    await ageInvitation(company, stuck.invitationId);
    const lock = await holdInvitationLock(company, stuck.invitationId);
    try {
      const abandoning = transactions().abandonStale(
        abandonStaleInput(company, stuck.invitationId),
      );
      await waitForWaiters(1);
      const completing = transactions().complete(
        completeInput(company, stuck.invitationId, stuck.userId),
      );
      await waitForWaiters(2);
      lock.release();
      await lock.holder;
      expect(await abandoning).toBe(true);
      expect(await completing).toEqual({ done: false, refusal: 'MEMBER_INVITATION_EXISTS' });
      expect(
        await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company} AND user_id = ${stuck.userId}`,
      ).toEqual([{ n: 0 }]);
    } finally {
      lock.release();
      await lock.holder.catch(() => undefined);
    }
  });
});

describe('E1 — the authority is read after the invitation row lock', () => {
  it('a DENY recorded while the stale abandon waits for the row lock is honoured: no cancel, no removal', async () => {
    const company = await companyWithTwoOwners('G1LK Abandon Authority After Lock');
    const email = 'abandon-authority-lock@example.test';
    const stuck = await stuckAfterAccount(company, email);
    await ageInvitation(company, stuck.invitationId);
    const lock = await holdInvitationLock(company, stuck.invitationId);
    try {
      const abandoning = transactions().abandonStale(
        abandonStaleInput(company, stuck.invitationId),
      );
      await waitForWaiters(1);
      await denyInvitations(company, ownerB.userId);
      lock.release();
      await lock.holder;
      expect(await abandoning).toBe(false);
      expect(await stateOf(company, stuck.invitationId)).toBe('PENDING');
      expect(await accountsOf(email)).toHaveLength(1);
    } finally {
      lock.release();
      await lock.holder.catch(() => undefined);
    }
  });

  it('a DENY recorded while the completion waits for the row lock is honoured', async () => {
    const company = await companyWithTwoOwners('G1LK Authority After Lock');
    const stuck = await stuckAfterAccount(company, 'authority-after-lock@example.test');
    const lock = await holdInvitationLock(company, stuck.invitationId);
    try {
      const completing = transactions().complete(
        completeInput(company, stuck.invitationId, stuck.userId),
      );
      await waitForWaiters(1);
      await denyInvitations(company, ownerA.userId);
      lock.release();
      await lock.holder;
      expect(await completing).toEqual({ done: false, refusal: 'FORBIDDEN' });
      expect(
        await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company} AND user_id = ${stuck.userId}`,
      ).toEqual([{ n: 0 }]);
    } finally {
      lock.release();
      await lock.holder.catch(() => undefined);
    }
  });
});

describe('E1 — the scope is checked before «already complete»', () => {
  it('an already-complete invitation whose scope vanished is refused 422, not answered as done', async () => {
    const company = await companyWithTwoOwners('G1LK Scope Before Done');
    const business = ids.newId();
    const branch = ids.newId();
    await h.owner`INSERT INTO businesses (company_id, id, name_en, vertical_type) VALUES (${company}, ${business}, 'B', 'salon')`;
    await h.owner`INSERT INTO branches (company_id, id, business_id, name_en) VALUES (${company}, ${branch}, ${business}, 'Br')`;
    const email = 'scope-before-done@example.test';
    const first = await invite(ownerA, company, email, {
      role: 'branch_manager',
      scope: { type: 'BRANCH', id: branch },
    });
    expect(first.status).toBe(201);
    // الفرع اختفى من الشركة بعد الإتمام (العضوية بتمنع مسحه فعلياً): صف الدعوة بيشاور على فرع مالوش وجود.
    await h.owner`UPDATE member_invitations SET scope_id = ${ids.newId()} WHERE company_id = ${company}`;
    const [row] = await h.owner`
      SELECT id, user_id FROM member_invitations WHERE company_id = ${company}`;
    const again = await transactions().complete(
      completeInput(company, String(row?.['id']), String(row?.['user_id'])),
    );
    expect(again).toEqual({ done: false, refusal: 'MEMBER_ROLE_NOT_INVITABLE' });
  });
});
