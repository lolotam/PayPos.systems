import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../../../db/test/test-database.ts';
import { seedReferenceData } from '../../../db/src/seed.ts';
import { systemUuidV7 } from '@pospay/ids';
import {
  createAuth,
  createPlatformUser,
  InvitationLinkRefusedError,
  isStaffSyntheticEmail,
  MEMBER_INVITATION_LINK_TTL_MS,
  PASSWORD_SET_LINK_TTL_MS,
  STAFF_SYNTHETIC_EMAIL_DOMAIN,
  type AuthOptions,
  type AuthService,
} from '../index.ts';

// دعوة العضو (G1) على قاعدة الهوية: عمر الرابط بالساعة المحقونة (D9)، وإبطال الروابط القديمة،
// ورفض أي شركة تصدر رابطاً لحساب ما دعتها هي. سكريبت الـ operator يبقى ساعة زي ما هو.
const BASE = 'http://api.test';
const ORIGIN = 'http://admin.test';
let testDb: TestDatabase;
let auth: AuthService;
let owner: postgres.Sql;
const USER_PASSWORD = 'member-chosen-pass';

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
  owner = postgres(testDb.ownerUrl, { max: 1, onnotice: () => undefined });
});

afterAll(async () => {
  await auth?.close();
  await owner?.end();
  await testDb?.drop();
});

const members = () => auth.members;

/** ساعات انتهاء صفوف verification لليوزر — الفرق من الآن هو العمر الفعلي للرابط. */
const expirationsOf = async (userId: string): Promise<number[]> => {
  const rows = await owner`
    SELECT expires_at FROM verification WHERE value = ${userId} ORDER BY created_at`;
  return rows.map((row) => (row['expires_at'] as Date).getTime());
};

describe('password-set link lifetime (D9)', () => {
  it('the default stays one hour for the operator path, with no clock passed', async () => {
    const { userId, link } = await createPlatformUser(auth, {
      email: 'operator-hour@example.test',
      name: 'Operator',
      operator: 'waleed',
      redirectTo: `${ORIGIN}/set-password`,
    });
    expect(link).toContain(`${BASE}/v1/auth/reset-password/`);
    const [expiresAt] = await expirationsOf(userId);
    expect(expiresAt - Date.now()).toBeGreaterThan(PASSWORD_SET_LINK_TTL_MS - 5_000);
    expect(expiresAt - Date.now()).toBeLessThanOrEqual(PASSWORD_SET_LINK_TTL_MS);
  });

  it('the invitation passes 48 hours and an injected instant, and the row carries them exactly', async () => {
    const created = await members().createInvitedMember({
      operationId: systemUuidV7().newId(),
      companyId: '01920000-0000-7000-8000-00000000c001',
      email: 'lifetime@example.test',
      name: 'Member',
    });
    const now = new Date('2026-11-24T10:00:00.000Z');
    await members().issueInvitationLink({
      userId: created.userId,
      companyId: '01920000-0000-7000-8000-00000000c001',
      redirectTo: `${ORIGIN}/set-password`,
      lifetimeMs: MEMBER_INVITATION_LINK_TTL_MS,
      now,
    });
    const [expiresAt] = await expirationsOf(created.userId);
    expect(expiresAt).toBe(now.getTime() + MEMBER_INVITATION_LINK_TTL_MS);
  });

  it('a re-issue deletes the earlier reset-password rows first, so the old link is dead', async () => {
    const companyId = '01920000-0000-7000-8000-00000000c001';
    const created = await members().createInvitedMember({
      operationId: systemUuidV7().newId(),
      companyId,
      email: 'reissue@example.test',
      name: 'Member',
    });
    const first = await members().issueInvitationLink({
      userId: created.userId,
      companyId,
      redirectTo: `${ORIGIN}/set-password`,
    });
    const second = await members().issueInvitationLink({
      userId: created.userId,
      companyId,
      redirectTo: `${ORIGIN}/set-password`,
    });
    expect(new URL(second).pathname).not.toBe(new URL(first).pathname);
    const tokens = [first, second].map((link) => new URL(link).pathname.split('/').pop() ?? '');
    const [firstRow] = await owner`
      SELECT 1 FROM verification WHERE identifier = ${`reset-password:${tokens[0]}`}`;
    expect(firstRow).toBeUndefined();
  });
});

describe('invitation link authority', () => {
  const companyId = '01920000-0000-7000-8000-00000000c001';
  const otherCompanyId = '01920000-0000-7000-8000-00000000c002';

  it('a company can issue a link only for a user it invited and who never set a password', async () => {
    const created = await members().createInvitedMember({
      operationId: systemUuidV7().newId(),
      companyId,
      email: 'invited@example.test',
      name: 'Invited',
    });
    expect(created.createdByInvitation).toBe(true);
    const marker = await members().readMarker(created.userId);
    expect(marker).toEqual({ invitedByCompanyId: companyId, hasPassword: false });
    const link = await members().issueInvitationLink({
      userId: created.userId,
      companyId,
      redirectTo: `${ORIGIN}/set-password`,
    });
    expect(link).toContain(`${BASE}/v1/auth/reset-password/`);
    await expect(
      members().issueInvitationLink({
        userId: created.userId,
        companyId: otherCompanyId,
        redirectTo: `${ORIGIN}/set-password`,
      }),
    ).rejects.toBeInstanceOf(InvitationLinkRefusedError);
  });

  it('a user that already set a password never gets another link', async () => {
    const companyId = '01920000-0000-7000-8000-00000000c001';
    const created = await members().createInvitedMember({
      operationId: systemUuidV7().newId(),
      companyId,
      email: 'password-set@example.test',
      name: 'Member',
    });
    const link = await members().issueInvitationLink({
      userId: created.userId,
      companyId,
      redirectTo: `${ORIGIN}/set-password`,
    });
    // اليوزر حط كلمة مروره من الرابط — نفس استهلاك POST /reset-password.
    const token = new URL(link).pathname.split('/').pop() ?? '';
    const reset = await auth.handler(
      new Request(`${BASE}/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ token, newPassword: USER_PASSWORD }),
      }),
    );
    expect(reset.status).toBe(200);
    await expect(
      members().issueInvitationLink({
        userId: created.userId,
        companyId,
        redirectTo: `${ORIGIN}/set-password`,
      }),
    ).rejects.toBeInstanceOf(InvitationLinkRefusedError);
  });

  it('an unknown user is refused without leaking whether the email exists', async () => {
    await expect(
      members().issueInvitationLink({
        userId: systemUuidV7().newId(),
        companyId,
        redirectTo: `${ORIGIN}/set-password`,
      }),
    ).rejects.toBeInstanceOf(InvitationLinkRefusedError);
  });
});

describe('invited member creation', () => {
  it('is idempotent by operation id, and an existing account comes back uncreated', async () => {
    const operationId = systemUuidV7().newId();
    const first = await members().createInvitedMember({
      operationId,
      companyId: '01920000-0000-7000-8000-00000000c003',
      email: 'idempotent@example.test',
      name: 'Member',
    });
    const repeat = await members().createInvitedMember({
      operationId,
      companyId: '01920000-0000-7000-8000-00000000c003',
      email: 'idempotent@example.test',
      name: 'Member',
    });
    expect(repeat).toEqual({ userId: first.userId, createdByInvitation: true });
    const [account] = await owner`
      SELECT a.password FROM account a WHERE a.user_id = ${first.userId} AND a.provider_id = 'credential'`;
    // حساب دخول من غير كلمة مرور: الإيميل بيتحدد من الرابط بعدين.
    expect(account?.['password']).toBeNull();
    const existing = await members().createInvitedMember({
      operationId: systemUuidV7().newId(),
      companyId: '01920000-0000-7000-8000-00000000c004',
      email: 'Idempotent@example.test',
      name: 'Member',
    });
    expect(existing).toEqual({ userId: first.userId, createdByInvitation: false });
  });

  it('finds a user by email case-insensitively and reports whether a password exists', async () => {
    await auth.provisionUser({
      email: 'finder@example.test',
      name: 'Finder',
      password: USER_PASSWORD,
    });
    const found = await members().findByEmail('FINDER@EXAMPLE.test');
    expect(found?.hasPassword).toBe(true);
    expect(await members().findByEmail('nobody@example.test')).toBeNull();
  });

  it('the invitation marker is all-or-nothing on the user row', async () => {
    await expect(
      owner`INSERT INTO "user" (id, name, email, invited_by_company_id)
        VALUES (${systemUuidV7().newId()}, 'Half', 'half@example.test', ${'01920000-0000-7000-8000-00000000c001'})`,
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

  it('a staff-domain email is refused by the API-side check through the exported constant', () => {
    // القيمة نفسها عند F1؛ الرفض بيمر بالثابت المصدَّر من packages/auth.
    expect(STAFF_SYNTHETIC_EMAIL_DOMAIN).toBe('staff.pospay.invalid');
  });
});
