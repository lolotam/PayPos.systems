import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { canonicalJson, type AuthDatabase } from '@pospay/db';
import type { buildBetterAuth } from './config.ts';
import type { passkeyPolicy } from './passkey-policy.ts';

/** السياق يأتي من خادم الموظفين بعد إثبات الجلسة، وليس من الحقل الذي يرسله المتصفح. */
export interface EnrollmentScope {
  readonly userId: string;
  readonly sessionId: string;
  readonly companyId: string;
  readonly businessId: string;
  readonly employeeId: string;
}
/** نسخة الربط والفرع والعملية وQR مثبتة لكل حركة حضور منفردة. */
export interface AttendanceScope extends EnrollmentScope {
  readonly bindingId: string;
  readonly bindingRevision: number;
  readonly passkeyId: string;
  readonly branchId: string;
  readonly operation: 'CLOCK_IN' | 'CLOCK_OUT';
  readonly qrContext: string;
}

/** دليل داخلي أحادي الاستعمال؛ لا يمر إلى HTTP ولا يحل محل قفل الربط في PR22. */
const PROOF: unique symbol = Symbol('attendance-operation-proof');
export interface AttendanceProof {
  readonly [PROOF]: true;
  consume(scope: AttendanceScope): boolean;
}

type EnrollmentResponse = Omit<
  RegistrationResponseJSON,
  'response' | 'authenticatorAttachment' | 'clientExtensionResults'
> & {
  authenticatorAttachment?: RegistrationResponseJSON['authenticatorAttachment'] | undefined;
  clientExtensionResults: { credProps?: { rk?: boolean | undefined } | undefined };
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: RegistrationResponseJSON['response']['transports'] | undefined;
    authenticatorData?: string | undefined;
    publicKey?: string | undefined;
    publicKeyAlgorithm?: number | undefined;
  };
};

type Auth = ReturnType<typeof buildBetterAuth>;
type AttendanceResponse = Omit<
  AuthenticationResponseJSON,
  'response' | 'authenticatorAttachment'
> & {
  authenticatorAttachment?: AuthenticationResponseJSON['authenticatorAttachment'] | undefined;
  response: Omit<AuthenticationResponseJSON['response'], 'userHandle'> & {
    userHandle?: string | undefined;
  };
};
/** القارئ المحقون يملك ربط الموظفين؛ auth لا يقرأ أي جدول شركة. */
export interface ActivePasskeyBindings {
  /** يرجع المعرفات العالمية للروابط النشطة فقط، بعد إثبات المستخدم. */
  forUser(scope: EnrollmentScope): Promise<readonly string[]>;
}
interface Options {
  auth: Auth;
  database: AuthDatabase;
  policy: ReturnType<typeof passkeyPolicy>;
  ids: { newId(): string };
  now(): Date;
  bindings?: ActivePasskeyBindings | undefined;
}

/** التسجيل عبر adapter الـ plugin؛ لا ننشئ جلسة دخول أو نعطي المتصفح مادة الاعتماد. */
export function createPasskeyFacade(options: Options) {
  return {
    enrollmentOptions: (scope: EnrollmentScope) => enrollmentOptions(options, scope),
    enroll: (scope: EnrollmentScope, challengeId: string, response: EnrollmentResponse) =>
      enroll(options, scope, challengeId, response),
    attendanceOptions: (scope: AttendanceScope) => attendanceOptions(options, scope),
    verifyAttendance: (scope: AttendanceScope, challengeId: string, response: AttendanceResponse) =>
      verifyAttendance(options, scope, challengeId, response),
  };
}
export type PasskeyFacade = ReturnType<typeof createPasskeyFacade>;

async function store(options: Options, prefix: string, value: unknown, seconds: number) {
  const id = options.ids.newId();
  await (
    await options.auth.$context
  ).internalAdapter.createVerificationValue({
    identifier: `${prefix}:${id}`,
    value: JSON.stringify(value),
    expiresAt: new Date(options.now().getTime() + seconds * 1000),
  });
  return id;
}

async function enrollmentOptions(options: Options, scope: EnrollmentScope) {
  if (options.policy.origins.length === 0 || options.bindings === undefined)
    throw new Error('PASSKEY_UNAVAILABLE');
  const activeIds = new Set(await options.bindings.forUser(scope));
  const generated = await options.auth.api.generatePasskeyRegistrationOptions({
    query: { context: scope.userId },
    returnHeaders: true,
  });
  const credentials = await (
    await options.auth.$context
  ).adapter.findMany<{
    id: string;
    credentialID: string;
  }>({ model: 'passkey', where: [{ field: 'userId', value: scope.userId }] });
  const activeCredentials = new Set(
    credentials.filter((credential) => activeIds.has(credential.id)).map((c) => c.credentialID),
  );
  // cookie الـ plugin داخلي فقط؛ لا يصل إلى المتصفح أو domain مشترك.
  const cookie = generated.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  const challengeId = await store(
    options,
    'staff-register',
    { scope: JSON.stringify(scope), cookie },
    120,
  );
  // الاعتماد الذي فشل ربطه لا يمنع نفس الجهاز من إنشاء اعتماد جديد؛ لا نفعّل اليتيم ضمنياً.
  return {
    challengeId,
    options: {
      ...generated.response,
      excludeCredentials: (generated.response.excludeCredentials ?? []).filter((credential) =>
        activeCredentials.has(credential.id),
      ),
    },
  };
}

async function enroll(
  options: Options,
  scope: EnrollmentScope,
  challengeId: string,
  response: EnrollmentResponse,
): Promise<string | null> {
  try {
    const context = await options.auth.$context;
    const row = await context.internalAdapter.consumeVerificationValue(
      `staff-register:${challengeId}`,
    );
    if (row === null || row.expiresAt <= options.now()) return null;
    const stored = JSON.parse(row.value) as { scope: string; cookie: string };
    if (stored.scope !== JSON.stringify(scope)) return null;
    const credential = await options.auth.api.verifyPasskeyRegistration({
      headers: new Headers({ cookie: stored.cookie }),
      body: { response: response as RegistrationResponseJSON, createSession: false },
    });
    return credential.userId === scope.userId ? credential.id : null;
  } catch {
    return null;
  }
}

async function attendanceOptions(options: Options, scope: AttendanceScope) {
  if (options.policy.origins.length === 0) throw new Error('PASSKEY_UNAVAILABLE');
  const generated = await generateAuthenticationOptions({
    rpID: options.policy.rpID,
    userVerification: 'required',
    timeout: 120_000,
  });
  const challengeId = await store(
    options,
    'staff-clock',
    { scope: canonicalJson(scope), challenge: generated.challenge },
    120,
  );
  return { challengeId, options: generated };
}

async function verifyAttendance(
  options: Options,
  scope: AttendanceScope,
  challengeId: string,
  response: AttendanceResponse,
): Promise<AttendanceProof | null> {
  const frozenScope = canonicalJson(scope);
  const accepted = await options.database.consumeAssertion({
    identifier: `staff-clock:${challengeId}`,
    userId: scope.userId,
    passkeyId: scope.passkeyId,
    scope: frozenScope,
    verify: async (challenge, credential) => {
      if (response.id !== credential.credentialId) return null;
      const result = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedRPID: options.policy.rpID,
        expectedOrigin: options.policy.origins,
        requireUserVerification: true,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64')),
          counter: credential.counter,
        },
      });
      return result.verified ? result.authenticationInfo.newCounter : null;
    },
  });
  if (!accepted) return null;
  let used = false;
  return {
    [PROOF]: true,
    consume: (current) => {
      if (used || options.now() >= accepted) return false;
      used = true;
      return sameScope(current, frozenScope);
    },
  };
}

// ترتيب مفاتيح الـ object مش جزء من النطاق؛ أي قيمة مش JSON بترفض بدل ما ترمي بعد صرف الدليل.
function sameScope(current: AttendanceScope, frozenScope: string): boolean {
  try {
    return canonicalJson(current) === frozenScope;
  } catch {
    return false;
  }
}
