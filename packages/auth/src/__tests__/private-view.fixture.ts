import { randomUUID } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import postgres from 'postgres';
import { systemUuidV7 } from '@pospay/ids';
import {
  staffPrivateViewIdentifier,
  staffPrivateViewSequenceIdentifier,
} from '@pospay/db';
import { createAuth, type AuthService } from '../config.ts';
import { hashCashierPin } from '../cashier-pin.ts';
import type { PrivateViewProof, PrivateViewScope } from '../private-view.ts';
import { STAFF_COOKIE } from '../staff-sessions.ts';
import type { StaffDeviceContext, StaffSession } from '../staff-otp/types.ts';
import { staffAuthFixture, type StaffAuthFixture } from './staff-auth.fixture.ts';

/** يبني نطاق النافذة من صف جلسة ومن جهاز. */
export type ScopeFactory = (sessionId: string, deviceId?: string) => PrivateViewScope;

/** جلسة صادرة مع نطاقها وجهازها. */
export interface IssuedPrivateSession {
  readonly issued: { readonly session: StaffSession; readonly cookie: string };
  readonly scope: PrivateViewScope;
  readonly device: StaffDeviceContext;
}

/** جلسة مشوّهة الجهاز: مالهاش جهاز UUID، عشان مسار الحذف اللي مافيش فيه قفل. */
export interface MalformedPrivateSession {
  readonly scope: PrivateViewScope;
  readonly device: StaffDeviceContext;
  readonly cookie: string;
  readonly sessionId: string;
}

/** صف النافذة والعداد كما تُقرآن من القاعدة. */
export interface PrivateViewRows {
  readonly window: readonly postgres.Row[];
  readonly counter: readonly postgres.Row[];
}

/** قفل صف النافذة من اتصال تاني. */
export interface HeldPrivateWindow {
  readonly release: () => void;
  readonly holding: Promise<void>;
}

/** كل ما تحتاجه اختبارات النافذة الخاصة: الإعداد المشترك وأدوات النافذة. */
export interface PrivateViewFixture extends Omit<StaffAuthFixture, 'auth' | 'close'> {
  readonly auth: AuthService;
  readonly hash: string;
  readonly scope: ScopeFactory;
  readonly prove: (proofScope: PrivateViewScope) => Promise<PrivateViewProof | null>;
  readonly issue: (device?: StaffDeviceContext) => Promise<IssuedPrivateSession>;
  readonly issueMalformed: () => Promise<MalformedPrivateSession>;
  readonly rows: (sessionId: string) => Promise<PrivateViewRows>;
  readonly holdWindowLock: (sessionId: string) => Promise<HeldPrivateWindow>;
  readonly waitForLockWaiters: (count: number, deadline: number) => Promise<void>;
  close(): Promise<void>;
}

/** Keeps the shared staff database setup while making every private window id reproducible. */
export async function privateViewFixture(): Promise<PrivateViewFixture> {
  const fixture = await staffAuthFixture();
  await fixture.auth.close();
  const holder = postgres(fixture.test.ownerUrl, { max: 1, onnotice: () => undefined });
  const hash = await hashCashierPin('1234');
  const auth = await createPrivateViewAuth(fixture);
  const scope: ScopeFactory = (sessionId, deviceId = fixture.device.deviceId) => ({
    sessionId,
    userId: fixture.userId,
    deviceId,
  });
  const issue = async (device = fixture.device): Promise<IssuedPrivateSession> => {
    const issued = await auth.staff.issue(fixture.userId, device, async () => true);
    return { issued, scope: scope(issued.session.sessionId, device.deviceId), device };
  };
  return {
    ...fixture,
    auth,
    hash,
    scope,
    prove: (proofScope: PrivateViewScope) =>
      auth.privateView.provePin({ pin: '1234', hash, scope: proofScope }),
    issue,
    issueMalformed: () => issueMalformedSession(fixture, scope),
    rows: (sessionId: string) => readPrivateRows(fixture, sessionId),
    holdWindowLock: (sessionId: string) => holdWindowLock(holder, sessionId),
    waitForLockWaiters: (count: number, deadline: number) =>
      waitForLockWaiters(fixture, count, deadline),
    close: async () => {
      await auth.close();
      await holder.end();
      await fixture.owner.end();
      await fixture.test.drop();
    },
  };
}

/** The auth the private-view specs drive: the same staff auth on a reproducible entropy. */
async function createPrivateViewAuth(fixture: StaffAuthFixture): Promise<AuthService> {
  let sequence = 0;
  return createAuth({
    databaseUrl: fixture.test.authUrl,
    staffPhoneLockKey: () => 1n,
    secret: 'synthetic'.repeat(8),
    baseURL: 'https://api.synthetic.invalid',
    trustedOrigins: ['https://pos.synthetic.invalid', 'https://admin.synthetic.invalid'],
    ids: systemUuidV7(),
    secureCookies: true,
    cookieDomain: '.synthetic.invalid',
    clock: { now: () => fixture.clock.now },
    entropy: {
      bytes: (length) => {
        const bytes = new Uint8Array(length);
        for (let index = 0; index < length; index += 1) bytes[index] = (sequence + index) & 0xff;
        sequence += 1;
        return bytes;
      },
    },
    onLog: () => undefined,
  });
}

async function issueMalformedSession(
  fixture: StaffAuthFixture,
  scope: ScopeFactory,
): Promise<MalformedPrivateSession> {
  const sessionId = randomUUID();
  const token = randomUUID();
  const device = { ...fixture.device, deviceId: 'not-a-uuid' };
  const deadline = new Date(fixture.clock.now.getTime() + 28_800_000);
  await fixture.owner`INSERT INTO session(id,token,user_id,expires_at,purpose,staff_device_context,
    staff_authenticated_at,staff_absolute_deadline)
    VALUES(${sessionId},${token},${fixture.userId},${deadline},'STAFF_POS',${fixture.owner.json(device)},
    ${fixture.clock.now},${deadline})`;
  const signature = await makeSignature(token, 'synthetic'.repeat(8));
  return {
    scope: scope(sessionId, device.deviceId),
    device,
    cookie: `${STAFF_COOKIE}=${encodeURIComponent(`${token}.${signature}`)}`,
    sessionId,
  };
}

async function readPrivateRows(
  fixture: StaffAuthFixture,
  sessionId: string,
): Promise<PrivateViewRows> {
  return {
    window: await fixture.owner`SELECT identifier,value,created_at,updated_at,expires_at FROM verification
      WHERE identifier=${staffPrivateViewIdentifier(sessionId)}`,
    counter: await fixture.owner`SELECT identifier,value,created_at,updated_at,expires_at FROM verification
      WHERE identifier=${staffPrivateViewSequenceIdentifier(sessionId)}`,
  };
}

async function holdWindowLock(
  holder: postgres.Sql,
  sessionId: string,
): Promise<HeldPrivateWindow> {
  let release = () => {};
  let acquired = () => {};
  const released = new Promise<boolean>((resolve) => {
    release = () => resolve(true);
  });
  const locked = new Promise<boolean>((resolve) => {
    acquired = () => resolve(true);
  });
  const holding = holder.begin(async (tx) => {
    await tx`SELECT id FROM verification WHERE identifier=${staffPrivateViewIdentifier(sessionId)} FOR UPDATE`;
    acquired();
    await released;
  });
  await locked;
  return { release: () => release(), holding };
}

async function waitForLockWaiters(
  fixture: StaffAuthFixture,
  count: number,
  deadline: number,
): Promise<void> {
  for (;;) {
    const [row] = await fixture.owner`SELECT count(*)::int AS n FROM pg_locks l
      JOIN pg_stat_activity a ON a.pid = l.pid
      WHERE l.locktype IN ('transactionid','tuple') AND NOT l.granted
        AND a.datname = current_database()`;
    if ((row?.['n'] ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error('LOCK_WAITERS_NOT_REACHED');
  }
}

export const cookieHeaders: (cookie: string) => Headers = (cookie) =>
  new Headers({ cookie: cookie.split(';')[0] ?? '' });
