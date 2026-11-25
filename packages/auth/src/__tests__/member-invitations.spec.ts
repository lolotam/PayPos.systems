import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { seedReferenceData } from '../../../db/src/seed.ts';
import { systemUuidV7 } from '@pospay/ids';
import {
  createAuth,
  createPlatformUser,
  InvitationLinkRefusedError,
  isStaffSyntheticEmail,
  MEMBER_INVITATION_LINK_TTL_MS,
  STAFF_SYNTHETIC_EMAIL_DOMAIN,
  type AuthOptions,
  type AuthService,
} from '../index.ts';

// دعوة العضو (G1) على قاعدة الهوية: عمر الرابط بالساعة المحقونة (D9)، وإبطال الروابط القديمة،
// وسلطة الشركة، وسباق الإنشاء، وقفل الإصدار ضد استهلاك الرابط. رابط الـ operator يبقى ساعة.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
const COMPANY = '01920000-0000-7000-8000-00000000c001';
const OTHER_COMPANY = '01920000-0000-7000-8000-00000000c002';
const PASSWORD = 'member-chosen-pass';
let testDb: TestDatabase;
let auth: AuthService;
let owner: postgres.Sql;

const optionsFor = (databaseUrl: string): AuthOptions => ({
  databaseUrl,
  staffPhoneLockKey: () => {
    throw new Error('STAFF_OPERATIONS_UNAVAILABLE');
  },
  secret: 'test-secret-that-is-long-enough-for-hmac',
  baseURL: BASE,
  trustedOrigins: [ORIGIN],
  ids: systemUuidV7(),
  secureCookies: false,
  onLog: () => undefined,
});

beforeAll(async () => {
  testDb = await createTestDatabase();
  await seedReferenceData(testDb.ownerUrl);
  auth = await createAuth(optionsFor(testDb.authUrl));
  owner = postgres(testDb.ownerUrl, { max: 4, onnotice: () => undefined });
});

afterAll(async () => {
  await auth?.close();
  await owner?.end();
  await testDb?.drop();
});

const members = () => auth.members;
const tokenOf = (link: string) => new URL(link).pathname.split('/').pop() ?? '';

async function invitedUser(email: string, companyId = COMPANY): Promise<string> {
  const created = await members().createInvitedMember({
    operationId: systemUuidV7().newId(),
    companyId,
    email,
    name: 'Member',
  });
  if (!created.createdByInvitation) throw new Error('the invitation should have created the account');
  return created.userId;
}

const issue = (userId: string, companyId = COMPANY, now = new Date()) =>
  members().issueInvitationLink({
    userId,
    companyId,
    redirectTo: `${ORIGIN}/set-password`,
    lifetimeMs: MEMBER_INVITATION_LINK_TTL_MS,
    now,
  });

const consume = (token: string) =>
  auth.handler(
    new Request(`${BASE}/v1/auth/reset-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN },
      body: JSON.stringify({ token, newPassword: PASSWORD }),
    }),
  );

const liveLinks = async (userId: string) =>
  owner`SELECT expires_at FROM verification WHERE value = ${userId} AND identifier LIKE 'reset-password:%'`;

describe('link lifetime (D9, IM-Q3)', () => {
  it('an operator link keeps its one-hour lifetime with the real clock', async () => {
    const { userId } = await createPlatformUser(auth, {
      email: 'operator-hour@example.test',
      name: 'Operator',
      operator: 'waleed',
      redirectTo: `${ORIGIN}/set-password`,
    });
    const [row] = await liveLinks(userId);
    const left = (row?.['expires_at'] as Date).getTime() - Date.now();
    expect(left).toBeGreaterThan(60 * 60 * 1000 - 5_000);
    expect(left).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('an invitation link expires exactly 48 hours after the injected instant', async () => {
    const userId = await invitedUser('lifetime@example.test');
    const now = new Date('2026-11-24T10:00:00.000Z');
    await issue(userId, COMPANY, now);
    const [row] = await liveLinks(userId);
    expect((row?.['expires_at'] as Date).getTime()).toBe(
      now.getTime() + MEMBER_INVITATION_LINK_TTL_MS,
    );
  });

  it('the token is stored exactly as Better Auth stores every reset token: plain in the identifier', async () => {
    const userId = await invitedUser('storage@example.test');
    const token = tokenOf(await issue(userId));
    const [row] = await owner`
      SELECT identifier, value FROM verification WHERE value = ${userId}`;
    expect(row).toEqual({ identifier: `reset-password:${token}`, value: userId });
  });
});

describe('invitation link authority and re-issue', () => {
  it('a re-issue leaves exactly one live token and kills the earlier one', async () => {
    const userId = await invitedUser('reissue@example.test');
    const first = tokenOf(await issue(userId));
    const second = tokenOf(await issue(userId));
    expect(second).not.toBe(first);
    const rows = await owner`SELECT identifier FROM verification WHERE value = ${userId}`;
    expect(rows.map((row) => row['identifier'])).toEqual([`reset-password:${second}`]);
    expect((await consume(first)).status).toBe(400);
  });

  it('concurrent re-issues leave exactly one live token', async () => {
    const userId = await invitedUser('concurrent@example.test');
    await Promise.all([issue(userId), issue(userId), issue(userId)]);
    expect(await liveLinks(userId)).toHaveLength(1);
  });

  it('another company and an unknown user are refused with the same error', async () => {
    const userId = await invitedUser('foreign@example.test');
    await expect(issue(userId, OTHER_COMPANY)).rejects.toBeInstanceOf(InvitationLinkRefusedError);
    await expect(issue(systemUuidV7().newId())).rejects.toBeInstanceOf(InvitationLinkRefusedError);
    expect(await liveLinks(userId)).toHaveLength(0);
  });

  it('a user who set a password never gets another link', async () => {
    const userId = await invitedUser('password-set@example.test');
    expect((await consume(tokenOf(await issue(userId)))).status).toBe(200);
    await expect(issue(userId)).rejects.toBeInstanceOf(InvitationLinkRefusedError);
  });
});

describe('the account row lock during a re-issue', () => {
  it('a password set while a re-issue holds the lock leaves no live link (P1-c)', async () => {
    const userId = await invitedUser('race@example.test');
    const old = tokenOf(await issue(userId));
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked: () => void = () => undefined;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    // يحاكي معاملة الإصدار: قفل صف الحساب، فحص «من غير كلمة مرور»، كتابة رابط جديد، وتأخير الإتمام؛
    // والاستهلاك بيمسح الرابط القديم ويستنى قفل صف الحساب قبل ما يحط كلمة المرور.
    const reissuing = owner.begin(async (tx) => {
      await tx`SELECT 1 FROM account WHERE user_id = ${userId} AND provider_id = 'credential' FOR UPDATE`;
      await tx`INSERT INTO verification (id, identifier, value, expires_at, created_at, updated_at)
        VALUES (${systemUuidV7().newId()}, 'reset-password:fresh-token', ${userId}, now() + interval '1 day', now(), now())`;
      locked();
      await held;
    });
    try {
      await lockTaken;
      const consuming = consume(old);
      // الحاجز: الاستهلاك واقف على قفل صف الحساب اللي معاملة الإصدار ماسكاه، مش انتظار زمني.
      await vi.waitFor(
        async () => {
          const [row] = await owner`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = ${testDb.name} AND wait_event_type = 'Lock'`;
          expect(Number(row?.['waiting'])).toBeGreaterThanOrEqual(1);
        },
        { timeout: 8_000, interval: 25 },
      );
      release();
      await reissuing;
      expect((await consuming).status).toBe(200);
      expect(await liveLinks(userId)).toHaveLength(0);
    } finally {
      // القفل بيتفك في كل الأحوال، وإلا باقي الملف بيفضل واقف على نفس صف الحساب.
      release();
      await reissuing.catch(() => undefined);
    }
  });
});

describe('email state and invited member creation', () => {
  it('inspectEmail tells free, taken and ours apart, case-insensitively', async () => {
    const operationId = systemUuidV7().newId();
    await members().createInvitedMember({
      operationId,
      companyId: COMPANY,
      email: 'state@example.test',
      name: 'State',
    });
    await auth.provisionUser({ email: 'plain@example.test', name: 'Plain', password: PASSWORD });
    expect(await members().inspectEmail('nobody@example.test', COMPANY)).toEqual({ kind: 'FREE' });
    expect(await members().inspectEmail('PLAIN@example.test', COMPANY)).toEqual({ kind: 'TAKEN' });
    expect(await members().inspectEmail('State@example.test', OTHER_COMPANY)).toEqual({
      kind: 'TAKEN',
    });
    expect(await members().inspectEmail('State@example.test', COMPANY)).toEqual({
      kind: 'OURS',
      operationId,
    });
    // بعد ما صاحب الحساب يحط كلمة مروره بقى حساب موجود عادي حتى لنفس الشركة (N1).
    await owner`UPDATE account SET password = 'x' WHERE provider_id = 'credential'
      AND user_id = (SELECT id FROM "user" WHERE email = 'state@example.test')`;
    expect(await members().inspectEmail('state@example.test', COMPANY)).toEqual({ kind: 'TAKEN' });
  });

  it('is idempotent by operation id and creates a credential account without a password', async () => {
    const operationId = systemUuidV7().newId();
    const input = { operationId, companyId: COMPANY, email: 'idempotent@example.test', name: 'M' };
    const first = await members().createInvitedMember(input);
    if (!first.createdByInvitation) throw new Error('the first call should create the account');
    expect(await members().createInvitedMember(input)).toEqual({
      userId: first.userId,
      createdByInvitation: true,
    });
    const [credential] = await owner`
      SELECT password FROM account WHERE user_id = ${first.userId} AND provider_id = 'credential'`;
    expect(credential?.['password']).toBeNull();
    expect(await members().hasPassword(first.userId)).toBe(false);
  });

  it('two companies racing on one email end with exactly one created account', async () => {
    const results = await Promise.all(
      [COMPANY, OTHER_COMPANY, COMPANY, OTHER_COMPANY].map((companyId) =>
        members().createInvitedMember({
          operationId: systemUuidV7().newId(),
          companyId,
          email: 'raced@example.test',
          name: 'Raced',
        }),
      ),
    );
    expect(results.filter((result) => result.createdByInvitation)).toHaveLength(1);
    const rows = await owner`SELECT id FROM "user" WHERE email = 'raced@example.test'`;
    expect(rows).toHaveLength(1);
    // الخاسر ما بيعرفش معرّف الحساب الغريب: ردّه من غير userId خالص.
    const winners = results.filter((result) => result.createdByInvitation);
    expect(winners.map((result) => (result.createdByInvitation ? result.userId : null))).toEqual([
      rows[0]?.['id'],
    ]);
    for (const loser of results.filter((result) => !result.createdByInvitation)) {
      expect(loser).toEqual({ createdByInvitation: false });
    }
  });
});

describe('discarding an abandoned invited account (G1 P1-4)', () => {
  const discard = (operationId: string, companyId = COMPANY) =>
    members().discardInvitedMember({ operationId, companyId });
  const accountOf = async (operationId: string) =>
    owner`SELECT id FROM "user" WHERE invitation_operation_id = ${operationId}`;

  it('removes a passwordless account of exactly that operation and company, with its links, and is repeatable', async () => {
    const operationId = systemUuidV7().newId();
    const created = await members().createInvitedMember({
      operationId,
      companyId: COMPANY,
      email: 'discard@example.test',
      name: 'Discard',
    });
    if (!created.createdByInvitation) throw new Error('expected a created account');
    await issue(created.userId);
    expect(await discard(operationId, OTHER_COMPANY)).toBe(true);
    expect(await accountOf(operationId)).toHaveLength(1);
    expect(await discard(operationId)).toBe(true);
    expect(await accountOf(operationId)).toHaveLength(0);
    expect(await liveLinks(created.userId)).toHaveLength(0);
    expect(await discard(operationId)).toBe(true);
  });

  it('keeps an account that already has a password', async () => {
    const operationId = systemUuidV7().newId();
    const created = await members().createInvitedMember({
      operationId,
      companyId: COMPANY,
      email: 'discard-kept@example.test',
      name: 'Kept',
    });
    if (!created.createdByInvitation) throw new Error('expected a created account');
    await owner`UPDATE account SET password = 'x' WHERE user_id = ${created.userId}`;
    expect(await discard(operationId)).toBe(false);
    expect(await accountOf(operationId)).toHaveLength(1);
  });
});

describe('the user row marker', () => {
  it('the invitation marker is all-or-nothing on the user row', async () => {
    await expect(
      owner`INSERT INTO "user" (id, name, email, invited_by_company_id)
        VALUES (${systemUuidV7().newId()}, 'Half', 'half@example.test', ${COMPANY})`,
    ).rejects.toThrow();
  });
});

describe('the reserved staff email domain (F1 boundary)', () => {
  it.each([
    [`sara-0192@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`, true],
    [`sara-0192@${STAFF_SYNTHETIC_EMAIL_DOMAIN.toUpperCase()}`, true],
    [` sara-0192@${STAFF_SYNTHETIC_EMAIL_DOMAIN} `, true],
    ['ahmed@example.test', false],
    ['staff.pospay.invalid', false],
    [`@${STAFF_SYNTHETIC_EMAIL_DOMAIN}`, false],
  ])('isStaffSyntheticEmail(%j) is %j', (email, expected) => {
    expect(isStaffSyntheticEmail(email)).toBe(expected);
  });
});
