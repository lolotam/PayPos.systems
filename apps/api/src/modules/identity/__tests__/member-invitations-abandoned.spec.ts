import postgres from 'postgres';
import { errorEnvelope } from '@pospay/contracts';
import { OWNER_ROLE_ID, SYSTEM_ROLES, type TenantWrappers } from '@pospay/db';
import { systemUuidV7 } from '@pospay/ids';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { startHarness, type Harness } from '../../../../test/harness.ts';
import { systemClock } from '../../../shared/adapters/system-clock.ts';
import { DATABASE } from '../../../shared/database.token.ts';
import { createMemberInvitationTransactions } from '../persistence/member-invitation-transactions.ts';

// دعوات اتوقفت قبل ما تكتمل (G1 P1-3، P1-4، E1): دعوة ملغية ما بتحجزش الإيميل، وحساب اتعمل من غير عضوية ولا
// رابط بيتلغى ويتمسح من الطلب اللي اترفض إتمامه أو من أول دعوة تالية بيعملها مالك حالي — وبيتكرر بأمان بعد
// انقطاع في النص — والسلطة بتتقرأ بعد قفل صف الدعوة مش قبله.
const ids = systemUuidV7();
let h: Harness;
// اتصال مستقل للحاجز: h.owner اتصال واحد، ومعاملة ماسكة القفل فيه كانت هتوقف قراءة المستنيين.
let locker: postgres.Sql;
// خطّاف بعد خطوة الفتح بالظبط: بيتنفذ مرة واحدة بعد أول معاملة بتكتب صف دعوة PENDING من غير عضوية.
let betweenSteps: (() => Promise<void>) | null = null;
const withBarrier = (db: TenantWrappers): TenantWrappers => ({
  ...db,
  withTenant: async (companyId, work, options) => {
    const result = await db.withTenant(companyId, work, options);
    const hook = betweenSteps;
    if (hook !== null) {
      const [pending] = await h.owner`
        SELECT 1 FROM member_invitations WHERE company_id = ${companyId} AND membership_id IS NULL
          AND state = 'PENDING'`;
      if (pending !== undefined) {
        betweenSteps = null;
        await hook();
      }
    }
    return result;
  },
});
const ownerA = { email: 'g1ab-owner-a@example.test', cookie: '', userId: '' };
const ownerB = { email: 'g1ab-owner-b@example.test', cookie: '', userId: '' };

beforeAll(async () => {
  h = await startHarness({ staffAccessRoutes: true, wrapDatabase: withBarrier });
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
const code = (response: { status: number; body: Record<string, unknown> }) => [
  response.status,
  errorEnvelope.parse(response.body).code,
];

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

describe('P1-3 — a cancelled invitation does not occupy the email', () => {
  it('a fresh invitation for the same email succeeds in the same company after a cancelled row', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1AB Cancelled Row');
    const email = 'cancelled-then-free@example.test';
    await h.owner`
      INSERT INTO member_invitations (company_id, id, email_hash, role_code, scope_type, scope_id,
        invited_by, state)
      VALUES (${company}, ${ids.newId()}, ${h.auth.members.hashEmail(email)}, 'accountant',
        'COMPANY', ${company}, ${ownerA.userId}, 'CANCELLED')`;
    const response = await invite(ownerA, company, email);
    expect(response.status).toBe(201);
    const rows = await h.owner`
      SELECT state FROM member_invitations WHERE company_id = ${company} ORDER BY state`;
    expect(rows.map((row) => row['state'])).toEqual(['CANCELLED', 'PENDING']);
  });

  it('the database still forbids two live rows for one email, and allows any number of cancelled ones', async () => {
    const company = await h.onboard(ownerA.cookie, 'G1AB Live Unique');
    const hash = h.auth.members.hashEmail('unique-live@example.test');
    const insert = (state: string) => h.owner`
      INSERT INTO member_invitations (company_id, id, email_hash, role_code, scope_type, scope_id,
        invited_by, state)
      VALUES (${company}, ${ids.newId()}, ${hash}, 'accountant', 'COMPANY', ${company},
        ${ownerA.userId}, ${state})`;
    await insert('CANCELLED');
    await insert('CANCELLED');
    await insert('PENDING');
    await expect(insert('PENDING')).rejects.toThrow();
    await expect(insert('ACTIVE')).rejects.toThrow();
  });
});

describe('P1-4 — an account left without membership or link is cancelled and the email freed', () => {
  it('a completion refused after the account exists cancels the invitation and removes the account', async () => {
    const company = await companyWithTwoOwners('G1AB Refused Completion');
    const email = 'refused-completion@example.test';
    betweenSteps = async () => denyInvitations(company, ownerA.userId);
    const refused = await invite(ownerA, company, email);
    betweenSteps = null;
    expect(code(refused)).toEqual([403, 'FORBIDDEN']);
    expect(await accountsOf(email)).toHaveLength(0);
    expect(
      await h.owner`SELECT state FROM member_invitations WHERE company_id = ${company}`,
    ).toEqual([{ state: 'CANCELLED' }]);
    // الإيميل حر: المالك الحالي B بيدعوه كأن العملية ما حصلتش.
    const fresh = await invite(ownerB, company, email);
    expect(fresh.status).toBe(201);
    expect(await accountsOf(email)).toHaveLength(1);
  });

  it('the next invitation by a current owner cancels an old stuck one (inviter lost authority) and goes through', async () => {
    const company = await companyWithTwoOwners('G1AB Stuck Old');
    const email = 'stuck-old@example.test';
    const stuck = await stuckAfterAccount(company, email);
    await denyInvitations(company, ownerA.userId);
    await ageInvitation(company, stuck.invitationId);
    const response = await invite(ownerB, company, email);
    expect(response.status).toBe(201);
    expect(await stateOf(company, stuck.invitationId)).toBe('CANCELLED');
    const accounts = await accountsOf(email);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.['id']).not.toBe(stuck.userId);
    expect(
      await h.owner`SELECT count(*)::int AS n FROM memberships WHERE company_id = ${company} AND user_id = ${accounts[0]?.['id']}`,
    ).toEqual([{ n: 1 }]);
  });

  it('a fresh unfinished invitation of another owner is left alone: 409 and the account stays', async () => {
    const company = await companyWithTwoOwners('G1AB Stuck Fresh');
    const email = 'stuck-fresh@example.test';
    const stuck = await stuckAfterAccount(company, email);
    const response = await invite(ownerB, company, email);
    expect(code(response)).toEqual([409, 'MEMBER_INVITATION_EXISTS']);
    expect(await stateOf(company, stuck.invitationId)).toBe('PENDING');
    expect(await accountsOf(email)).toHaveLength(1);
  });
});

describe('P1-4 — retry-safe after a crash, and never for finished work', () => {
  it('a crash after the row was cancelled but before the account was removed heals on the next invitation', async () => {
    const company = await companyWithTwoOwners('G1AB Half Cancelled');
    const email = 'half-cancelled@example.test';
    const stuck = await stuckAfterAccount(company, email);
    expect(
      await transactions().abandonOwn({
        companyId: company,
        actorUserId: ownerA.userId,
        invitationId: stuck.invitationId,
      }),
    ).toBe(true);
    expect(await accountsOf(email)).toHaveLength(1);
    const response = await invite(ownerB, company, email);
    expect(response.status).toBe(201);
    const accounts = await accountsOf(email);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.['id']).not.toBe(stuck.userId);
  });

  it('an invitation that already has a membership is never abandoned, however old', async () => {
    const company = await companyWithTwoOwners('G1AB Has Membership');
    const email = 'has-membership@example.test';
    const first = await invite(ownerA, company, email);
    expect(first.status).toBe(201);
    const invitationId = String(first.body['invitation_id']);
    await ageInvitation(company, invitationId);
    const second = await invite(ownerB, company, email);
    expect(code(second)).toEqual([409, 'MEMBER_INVITATION_EXISTS']);
    expect(await stateOf(company, invitationId)).toBe('PENDING');
    expect(await accountsOf(email)).toHaveLength(1);
  });

  it('an account that already has a password is never removed', async () => {
    const company = await companyWithTwoOwners('G1AB Has Password');
    const email = 'has-password@example.test';
    const stuck = await stuckAfterAccount(company, email);
    await ageInvitation(company, stuck.invitationId);
    await h.owner`UPDATE account SET password = 'x' WHERE user_id = ${stuck.userId}`;
    const response = await invite(ownerB, company, email);
    expect(code(response)).toEqual([422, 'MEMBER_EMAIL_NOT_INVITABLE']);
    expect(await accountsOf(email)).toHaveLength(1);
  });
});

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
  buildEvent: (row: { id: string }, membershipId: string, user: string) => ({
    aggregateType: 'member_invitation',
    aggregateId: row.id,
    eventType: 'MemberInvited',
    payload: { invitation_id: row.id, user_id: user, membership_id: membershipId },
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

describe('abandoning blocks completion while it runs, and the order is decided by the row lock', () => {
  it('a completion queued first wins and the abandon is refused (membership exists)', async () => {
    const company = await companyWithTwoOwners('G1AB Lock Complete First');
    const stuck = await stuckAfterAccount(company, 'lock-complete-first@example.test');
    await ageInvitation(company, stuck.invitationId);
    const lock = await holdInvitationLock(company, stuck.invitationId);
    const completing = transactions().complete(
      completeInput(company, stuck.invitationId, stuck.userId),
    );
    await waitForWaiters(1);
    const abandoning = transactions().abandonStale({
      companyId: company,
      actorUserId: ownerB.userId,
      invitationId: stuck.invitationId,
      roleCode: 'accountant',
      scope: { type: 'COMPANY', id: company },
      staleBefore: new Date(Date.now() - 60_000),
    });
    await waitForWaiters(2);
    lock.release();
    await lock.holder;
    expect(await completing).toMatchObject({ done: true, alreadyComplete: false });
    expect(await abandoning).toBe(false);
    expect(await stateOf(company, stuck.invitationId)).toBe('PENDING');
  });

  it('an abandon queued first wins and the completion is refused with no membership', async () => {
    const company = await companyWithTwoOwners('G1AB Lock Abandon First');
    const stuck = await stuckAfterAccount(company, 'lock-abandon-first@example.test');
    await ageInvitation(company, stuck.invitationId);
    const lock = await holdInvitationLock(company, stuck.invitationId);
    const abandoning = transactions().abandonStale({
      companyId: company,
      actorUserId: ownerB.userId,
      invitationId: stuck.invitationId,
      roleCode: 'accountant',
      scope: { type: 'COMPANY', id: company },
      staleBefore: new Date(Date.now() - 60_000),
    });
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
  });
});

describe('E1 — authority is read after the invitation row lock, and scope before «already complete»', () => {
  it('a DENY recorded while the stale abandon waits for the row lock is honoured: no cancel, no removal', async () => {
    const company = await companyWithTwoOwners('G1AB Abandon Authority After Lock');
    const email = 'abandon-authority-lock@example.test';
    const stuck = await stuckAfterAccount(company, email);
    await ageInvitation(company, stuck.invitationId);
    const lock = await holdInvitationLock(company, stuck.invitationId);
    const abandoning = transactions().abandonStale({
      companyId: company,
      actorUserId: ownerB.userId,
      invitationId: stuck.invitationId,
      roleCode: 'accountant',
      scope: { type: 'COMPANY', id: company },
      staleBefore: new Date(Date.now() - 60_000),
    });
    await waitForWaiters(1);
    await denyInvitations(company, ownerB.userId);
    lock.release();
    await lock.holder;
    expect(await abandoning).toBe(false);
    expect(await stateOf(company, stuck.invitationId)).toBe('PENDING');
    expect(await accountsOf(email)).toHaveLength(1);
  });

  it('a DENY recorded while the completion waits for the row lock is honoured', async () => {
    const company = await companyWithTwoOwners('G1AB Authority After Lock');
    const stuck = await stuckAfterAccount(company, 'authority-after-lock@example.test');
    const lock = await holdInvitationLock(company, stuck.invitationId);
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
  });

  it('an already-complete invitation whose scope vanished is refused 422, not answered as done', async () => {
    const company = await companyWithTwoOwners('G1AB Scope Before Done');
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

// E5 (AC-ACT-20): صف دعوة وقف قبل إنشاء الحساب (من غير حساب خالص) بيتلغى تحت قفله، والدعوة
// الجديدة لمالك حالي بتكمّل مكانه؛ وكمان لو الحساب القائم عملية ماتت (معرّفها مش معرّف صف
// الدعوة) فالحساب العالق بيتشال والإيميل يرجع حر.
describe('E5 — an invitation that stopped before its account was created is reclaimed', () => {
  it('a current owner re-invites the same email after the stale window and the invitation goes through', async () => {
    const company = await companyWithTwoOwners('G1AB Stuck Before Account');
    const email = 'stuck-before-account@example.test';
    // الطلب وقف بعد الفتح وقبل إنشاء الحساب: صف PENDING من غير يوزر ولا عضوية.
    const stuck = await stuckAfterAccount(company, email);
    await h.owner`DELETE FROM "user" WHERE id = ${stuck.userId}`;
    await ageInvitation(company, stuck.invitationId);
    const response = await invite(ownerB, company, email);
    expect([response.status, await stateOf(company, stuck.invitationId)]).toEqual([201, 'CANCELLED']);
    expect(await accountsOf(email)).toHaveLength(1);
    const abandoned = await h.owner`
      SELECT entity_id FROM audit_log WHERE company_id = ${company} AND action = 'invite.abandoned'`;
    expect(abandoned.map((row) => row['entity_id'])).toEqual([stuck.invitationId]);
  });

  it('the account of an abandoned attempt does not match the stale row: the row is reclaimed and the invitation goes through', async () => {
    const company = await companyWithTwoOwners('G1AB Mismatched Operation');
    const email = 'mismatched-operation@example.test';
    // الحساب بقى علق على عملية ماتت غير صف الدعوة.
    const stuck = await stuckAfterAccount(company, email);
    await h.owner`UPDATE "user" SET invitation_operation_id = ${ids.newId()} WHERE id = ${stuck.userId}`;
    await ageInvitation(company, stuck.invitationId);
    // نفس الداعي كان يقدر يستأنف الصف، بس الحساب مش بيته: فالمسار ينضف والدعوة تكمّل.
    const response = await invite(ownerA, company, email);
    expect([response.status, await stateOf(company, stuck.invitationId)]).toEqual([201, 'CANCELLED']);
    expect((await accountsOf(email)).map((row) => row['id'])).not.toContain(stuck.userId);
  });
});
