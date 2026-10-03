import { createHmac, timingSafeEqual } from 'node:crypto';
import { makeSignature } from 'better-auth/crypto';
import { parseCookies } from 'better-auth/cookies/utils';
import type { StaffOtpDatabase } from '@pospay/db';
import { sameDevice, staffDeadline } from './staff-otp/policy.ts';
import type { StaffDeviceContext, StaffSession } from './staff-otp/types.ts';

export const STAFF_COOKIE = 'pospay-staff.session_token';

/** تغير الإثبات رفض متوقع، منفصل عن فشل البنية التحتية. */
export class StaffProofChanged extends Error {}

interface SessionRow {
  readonly id: string;
  readonly token: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly purpose?: string | null;
  readonly staffDeviceContext?: unknown;
  readonly staffAuthenticatedAt?: Date | null;
  readonly staffAbsoluteDeadline?: Date | null;
}

export interface StaffSessionPrimitive {
  /** إصدار Better Auth فقط، بعد استهلاك الإثبات وعدم إمكانية إعادة تشغيله. */
  create(
    userId: string,
    device: StaffDeviceContext,
    now: Date,
    deadline: Date,
  ): Promise<SessionRow | null>;
  /** القراءة لا تجدد جلسة الوردية ولا تنقل موعدها المطلق. */
  find(token: string): Promise<SessionRow | null>;
  /** يلغي النتيجة غير المؤكدة دون استرجاع token أو إعادة الإصدار. */
  remove(token: string): Promise<void>;
}

export interface StaffSessions {
  close(): Promise<void>;
  /** تجهز اتصالات الاعتماد قبل قراءة أي هوية؛ لا تستعلم عن هاتف أو جدول شركة. */
  ready(): Promise<void>;
  /** يقرأ الربط العالمي المعتمد فقط؛ لا ينشئ مستخدماً ولا يمنح صلاحية شركة. */
  candidate(phone: string): Promise<string | null>;
  /** بصمة keyed خاصة بعداد PIN؛ الهاتف الغائب لا يشترك مع بقية الهواتف في قفل واحد. */
  pinCounterKey(phone: string): string;
  /** يتم تدوير المشغل بعد إنشاء الجلسة الجديدة وتأكيد المعاملة فقط. */
  issue(
    userId: string,
    device: StaffDeviceContext,
    validate: () => Promise<boolean>,
  ): Promise<{ session: StaffSession; cookie: string }>;
  /** يشترط cookie منفصلاً وسياق الجهاز نفسه، بلا صلاحيات منصة. */
  resolve(headers: Headers, device: StaffDeviceContext): Promise<StaffSession | null>;
  /** إلغاء الاعتماد لا يمس pairing ولا cookie الإدارة. */
  signOut(headers: Headers, device: StaffDeviceContext): Promise<string>;
  /** يمنع استبدال اسم cookie للوصول لمسارات Better Auth العادية. */
  normalPurpose(headers: Headers): Promise<boolean>;
}

interface SessionOptions {
  primitive: StaffSessionPrimitive;
  database: StaffOtpDatabase;
  secret: string;
  normalCookie: string;
  now(): Date;
}

export function createStaffSessions(options: SessionOptions): StaffSessions {
  const resolve = async (headers: Headers, device: StaffDeviceContext) => {
    const token = await verifiedToken(headers, STAFF_COOKIE, options.secret);
    if (token === null) return null;
    const row = await options.primitive.find(token);
    if (row === null) return null;
    const session = staffRow(row, device, options.now());
    return session !== null &&
      (await options.database.bindingValid(session.userId, session.authenticatedAt))
      ? session
      : null;
  };
  return {
    close: () => options.database.close(),
    ready: () => options.database.warm(),
    candidate: (phone) => options.database.lookup(phone, new Date(options.now().getTime() + 1000)),
    pinCounterKey: (phone) =>
      `staff-phone:${createHmac('sha256', options.secret)
        .update('pospay:staff-pin:counter:v1\0')
        .update(phone)
        .digest('hex')}`,
    issue: (userId, device, validate) => issueStaffSession(options, { userId, device, validate }),
    resolve,
    signOut: async (headers, device) => {
      const token = await verifiedToken(headers, STAFF_COOKIE, options.secret);
      const row = token === null ? null : await options.primitive.find(token);
      if (row !== null && staffRow(row, device, options.now()) !== null)
        await options.primitive.remove(row.token);
      return sessionCookie('', new Date(0));
    },
    normalPurpose: (headers) => normalPurpose(options, headers),
  };
}

const sessionCookie = (value: string, expires: Date) =>
  `${STAFF_COOKIE}=${value}; Path=/v1; HttpOnly; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`;

async function issueStaffSession(
  options: SessionOptions,
  request: {
    userId: string;
    device: StaffDeviceContext;
    validate(): Promise<boolean>;
  },
) {
  const { userId, device, validate } = request;
  const now = options.now();
  const deadline = staffDeadline(now);
  let made: SessionRow | null = null;
  let stage: 'CREATE' | 'ROTATE' | 'VALIDATE' | 'SIGN' = 'CREATE';
  let issued: { session: StaffSession; cookie: string } | undefined;
  let proofChanged = false;
  try {
    await options.database.rotate(device, async () => {
      made = await options.primitive.create(userId, device, now, deadline);
      if (made === null) throw new Error('STAFF_SESSION_REFUSED');
      stage = 'VALIDATE';
      const session = staffRow(made, device, options.now());
      if (session === null) throw new Error('STAFF_SESSION_REFUSED');
      if (!(await validate())) {
        proofChanged = true;
        throw new StaffProofChanged();
      }
      stage = 'SIGN';
      const signature = await makeSignature(made.token, options.secret);
      issued = {
        session,
        cookie: sessionCookie(encodeURIComponent(`${made.token}.${signature}`), deadline),
      };
      stage = 'ROTATE';
      return made;
    });
    if (issued === undefined) throw new Error('STAFF_SESSION_REFUSED');
    return issued;
  } catch (error) {
    const uncertain = made as SessionRow | null;
    if (uncertain !== null)
      await options.primitive.remove(uncertain.token).catch((failure) => {
        throw sessionFailure(failure, 'REVOKE');
      });
    throw proofChanged ? new StaffProofChanged() : sessionFailure(error, stage);
  }
}

function sessionFailure(error: unknown, stage: string): Error {
  const cause =
    error !== null && typeof error === 'object' && 'cause' in error ? error.cause : error;
  const code =
    cause !== null &&
    typeof cause === 'object' &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    /^[A-Z0-9_]{1,32}$/.test(cause.code)
      ? cause.code
      : 'OPERATION_FAILED';
  return new Error(`STAFF_SESSION_REFUSED_${stage}_${code}`);
}

async function normalPurpose(options: SessionOptions, headers: Headers): Promise<boolean> {
  const cookies = parseCookies(headers.get('cookie') ?? '');
  const raw =
    cookies.get(options.normalCookie) ?? cookies.get(options.normalCookie.replace('__Secure-', ''));
  if (raw === undefined) return !cookies.has(STAFF_COOKIE);
  const token = await verifiedToken(
    headers,
    cookies.has(options.normalCookie)
      ? options.normalCookie
      : options.normalCookie.replace('__Secure-', ''),
    options.secret,
  );
  if (token === null) return true;
  return (await options.primitive.find(token))?.purpose !== 'STAFF_POS';
}

function staffRow(row: SessionRow, device: StaffDeviceContext, now: Date): StaffSession | null {
  if (
    row.purpose !== 'STAFF_POS' ||
    row.staffDeviceContext === null ||
    typeof row.staffDeviceContext !== 'object' ||
    row.staffAuthenticatedAt === null ||
    row.staffAuthenticatedAt === undefined ||
    row.staffAbsoluteDeadline === null ||
    row.staffAbsoluteDeadline === undefined ||
    now >= row.staffAbsoluteDeadline ||
    row.expiresAt.getTime() !== row.staffAbsoluteDeadline.getTime() ||
    !sameDevice(row.staffDeviceContext as StaffDeviceContext, device)
  )
    return null;
  return {
    userId: row.userId,
    sessionId: row.id,
    context: device,
    authenticatedAt: row.staffAuthenticatedAt,
    deadline: row.staffAbsoluteDeadline,
  };
}

async function verifiedToken(
  headers: Headers,
  name: string,
  secret: string,
): Promise<string | null> {
  try {
    const encoded = parseCookies(headers.get('cookie') ?? '').get(name);
    if (encoded === undefined) return null;
    const value = decodeURIComponent(encoded);
    const index = value.lastIndexOf('.');
    if (index <= 0) return null;
    const token = value.slice(0, index);
    const signature = Buffer.from(value.slice(index + 1));
    const expected = Buffer.from(await makeSignature(token, secret));
    return signature.length === expected.length && timingSafeEqual(signature, expected)
      ? token
      : null;
  } catch {
    return null;
  }
}
