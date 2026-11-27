import { createStaffOtpDatabase } from '@pospay/db';
import { createOtpCrypto } from '../staff-otp/crypto.ts';
import { isStaffSyntheticEmail } from '../member-invitations.ts';
import type { EmailOtpConfiguration } from './configuration.ts';
import type { EmailOtpStrategies, OtpCapability, OtpRates, OtpSender } from '../staff-otp/types.ts';
import type { OtpChallenge } from '../staff-otp/types.ts';

/** صلاحية اعتماد الاسترجاع: عشرة دقايق من وقت القبول، مش من وقت الإرسال. */
export const PASSWORD_RESET_LIFETIME_MS = 600_000;
/** نافذة إعادة الطلب موحّدة لكل بريد قبل قراءة الأهلية. */
export const PASSWORD_RESET_RETRY_MS = 60_000;
/** نافذة التحضير الثابتة: الردّ الموحّد بيستنى لحد نهايتها مهما كانت النتيجة. */
const PREPARATION_WINDOW_MS = 200;

/** نتيجة الطلب: مقبول أو محدود أو غير متاح. */
export type PasswordResetRequestResult =
  | { readonly kind: 'accepted'; readonly challengeId: string }
  | { readonly kind: 'limited'; readonly retryAfter: number }
  | { readonly kind: 'unavailable' };

/** نتيجة التعيين: تم أو مرفوض أو محدود أو غير متاح. */
export type PasswordResetOutcome =
  | { readonly kind: 'reset' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'limited'; readonly retryAfter: number }
  | { readonly kind: 'unavailable' };

/** خيارات خدمة استرجاع كلمة المرور بالإيميل. */
export interface PasswordResetOtpApiOptions {
  readonly databaseUrl: string;
  configuration(): EmailOtpConfiguration;
  capability: OtpCapability;
  rates: OtpRates;
  sender: OtpSender;
  strategies: EmailOtpStrategies;
  ids: { newId(): string };
  clock: { now(): Date; waitUntil(deadline: Date): Promise<void> };
  /** مُجزّئ كلمات المرور — Better Auth هو اللي بيحسب، والخدمة بتستدعيه بره المعاملة. */
  readonly hasher: { hash(password: string): Promise<string> };
  onOutcome?: (outcome: string) => void;
}

/**
 * خدمة استرجاع كلمة المرور بالإيميل. بتقبل طلب كود، وبتستهلك الكود وتغيّر كلمة المرور.
 * كل ردّ الموحّد (202) بيتقفل قبل قراءة الحساب، والردود ما بتكشفش وجود ولا نوع الحساب.
 */
export function createPasswordResetOtpApi(options: PasswordResetOtpApiOptions) {
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.strategies.phoneLockKey,
    // حساب الاعتماد هو اللي بيقدّر كلمة المرور: حساب موظف اصطناعي مالوش استرجاع.
    credentialAccount: (email, staffAccessOperationId) =>
      staffAccessOperationId === null && !isStaffSyntheticEmail(email),
  });
  // بوابة داخل العملية لكل اعتماد: طلبان بنفس الاعتماد ما يحسبوش كلمة المرور مرتين.
  const inFlight = new Map<string, Promise<void>>();
  return {
    request: (input: { email: string; locale: 'ar' | 'en'; ip: string }) =>
      request(options, database, input),
    reset: (input: { challengeId: string; code: string; newPassword: string; ip: string }) =>
      reset(options, database, inFlight, input),
    readiness: () => database.ping(),
    close: () => database.close(),
  };
}

export type PasswordResetOtpApi = ReturnType<typeof createPasswordResetOtpApi>;

/** يثبّت البوابة على الاعتماد: الطلب التاني بنفس الاعتماد بيستنى الأول. */
function installGate(inFlight: Map<string, Promise<void>>, challengeId: string) {
  const previous = inFlight.get(challengeId);
  let release = (): void => undefined;
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  inFlight.set(challengeId, tail);
  return {
    previous,
    release: () => {
      release();
      if (inFlight.get(challengeId) === tail) inFlight.delete(challengeId);
    },
  };
}

type Database = ReturnType<typeof createStaffOtpDatabase>;

/** حد الطلب قبل أي قراءة: عدد ثواني الانتظار، أو null لو الطلب مقبول، أو 'unavailable' لو Redis وقع. */
async function admit(
  options: PasswordResetOtpApiOptions,
  hash: Uint8Array,
  ip: string,
  challengeId: string,
): Promise<number | 'unavailable'> {
  try {
    return await options.rates.request(hash, ip, challengeId);
  } catch {
    return 'unavailable';
  }
}

/** يبني الاعتماد والمحاولة بنفس الموعد: الصلاحية عشر دقايق من وقت القبول، مش من وقت الإرسال. */
async function prepare(
  options: PasswordResetOtpApiOptions,
  database: Database,
  config: Extract<EmailOtpConfiguration, { state: 'READY' }>,
  input: { email: string; locale: 'ar' | 'en' },
  ids: { challengeId: string; attemptId: string },
  createdAt: Date,
  deadline: Date,
) {
  const identity = options.strategies.identifyEmail(input.email);
  const challenge: OtpChallenge = {
    id: ids.challengeId,
    recipientHash: identity.hash,
    hashKeyId: identity.hashKeyId,
    userId: null,
    deviceContext: { purpose: 'PASSWORD_RESET' },
    codeMac: null,
    derivationKeyId: config.keys.derivationId,
    verificationKeyId: config.keys.verificationId,
    status: 'ACTIVE',
    failedAttempts: 0,
    createdAt,
    expiresAt: new Date(createdAt.getTime() + PASSWORD_RESET_LIFETIME_MS),
  };
  const crypto = createOtpCrypto(config.keys);
  const found = await database.lookupCredentialUserByEmail(input.email, deadline);
  const eligible =
    found !== null && found.staffAccessOperationId === null && !isStaffSyntheticEmail(found.email);
  return database.prepareEmailResetChallenge({
    challengeId: ids.challengeId,
    attemptId: ids.attemptId,
    recipientHash: identity.hash,
    hashKeyId: identity.hashKeyId,
    userId: found?.id ?? null,
    locale: input.locale,
    createdAt,
    expiresAt: challenge.expiresAt,
    preparationDeadline: deadline,
    derivationKeyId: config.keys.derivationId,
    verificationKeyId: config.keys.verificationId,
    eligible,
    auditId: options.ids.newId(),
    materializeMac: () => crypto.mac(challenge, crypto.derive(challenge)),
  });
}

/** يسلّم الاعتماد للطابور ثم يفرج عنه؛ فشل الطابور بيسحب التحضير ومايغيّرش الردّ. */
async function deliver(
  options: PasswordResetOtpApiOptions,
  database: Database,
  ids: { challengeId: string; attemptId: string },
  deadline: Date,
): Promise<void> {
  try {
    await options.sender.enqueue(ids, deadline);
  } catch {
    options.onOutcome?.('ENQUEUE_FAILED');
    await database.failPreparation(ids.challengeId, ids.attemptId, deadline).catch(() => undefined);
    return;
  }
  // الإرسال بيتأذن بعد ما الطابور يقبل المهمة، وبعد فحص الحظر تاني جوّه القفل.
  const authorized = await database
    .release(ids.challengeId, ids.attemptId, deadline, () => options.capability.ready(deadline))
    .catch(() => false);
  options.onOutcome?.(authorized ? 'AUTHORIZED' : 'NOT_AUTHORIZED');
}

const request = async (
  options: PasswordResetOtpApiOptions,
  database: Database,
  input: { email: string; locale: 'ar' | 'en'; ip: string },
): Promise<PasswordResetRequestResult> => {
  const config = options.configuration();
  if (config.state !== 'READY') {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  const email = input.email.trim().toLowerCase();
  const ids = { challengeId: options.ids.newId(), attemptId: options.ids.newId() };
  const rate = await admit(
    options,
    options.strategies.identifyEmail(email).hash,
    input.ip,
    ids.challengeId,
  );
  if (rate === 'unavailable') {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  if (rate > 0) return { kind: 'limited', retryAfter: rate };
  // وقت القبول واحد: الصلاحية والنافذة الثابتة بيتحسبوا منه، والقاعدة بتفرض نفس الفرق بالظبط.
  const createdAt = options.clock.now();
  const deadline = new Date(createdAt.getTime() + PREPARATION_WINDOW_MS);
  // فحص الجاهزية بعد حد المعدل ومحصور بنفس النافذة: الفيضان غير المصادق ما يوصلش لقاعدة الكتالوج.
  if (!(await readyWithin(options, deadline))) {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  try {
    const prepared = await prepare(
      options,
      database,
      config,
      { email, locale: input.locale },
      ids,
      createdAt,
      deadline,
    );
    if (prepared === 'PREPARED') await deliver(options, database, ids, deadline);
    else options.onOutcome?.('NOT_AUTHORIZED');
  } catch {
    options.onOutcome?.('PREPARATION_FAILED');
  }
  // نفس النافذة لكل حالة: ما بيبانش إيميل موجود ولا مؤهل ولا محظور.
  await options.clock.waitUntil(deadline);
  return { kind: 'accepted', challengeId: ids.challengeId };
};

/** فحص جاهزية القدرة تحت موعد النافذة؛ أي عطل في الفحص بيتعامل كأنها غير جاهزة. */
async function readyWithin(options: PasswordResetOtpApiOptions, deadline: Date): Promise<boolean> {
  try {
    return await options.capability.ready(deadline);
  } catch {
    return false;
  }
}

/** حد المحاولات: عدد ثواني الانتظار، أو null لو Redis وقع. */
async function verifyRate(
  options: PasswordResetOtpApiOptions,
  input: { challengeId: string; ip: string },
): Promise<number | null> {
  try {
    return await options.rates.verify(input.challengeId, input.ip);
  } catch {
    return null;
  }
}

/**
 * الفحص والتعيين تحت نافذة ثابتة 200ms زي التحقق من الواتساب: كل نتيجة غير مطابقة بتنتظر لنهاية
 * النافذة (والمطابقة بتنتظرها قبل تجزئة كلمة المرور البطيئة)، فالزمن مايفرّقش اعتماد غير موجود
 * عن محظور أو مستنفد أو كود غلط (spec 079 SC-003).
 */
const reset = async (
  options: PasswordResetOtpApiOptions,
  database: Database,
  inFlight: Map<string, Promise<void>>,
  input: { challengeId: string; code: string; newPassword: string; ip: string },
): Promise<PasswordResetOutcome> => {
  const config = options.configuration();
  if (config.state !== 'READY') {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  const deadline = new Date(options.clock.now().getTime() + PREPARATION_WINDOW_MS);
  // الحد قبل أي قراءة قاعدة: الفيضان غير المصادق يتردّ قبل فحص الجاهزية.
  const rate = await verifyRate(options, input);
  if (rate === null) {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  let waited = false;
  const settle = async () => {
    if (waited) return;
    waited = true;
    await options.clock.waitUntil(deadline);
  };
  try {
    if (rate > 0) return { kind: 'limited', retryAfter: rate };
    if (!(await readyWithin(options, deadline))) {
      options.onOutcome?.('UNAVAILABLE');
      return { kind: 'unavailable' };
    }
    return await verifyAndReset(options, database, inFlight, {
      ...input,
      config,
      deadline,
      settle,
    });
  } finally {
    await settle();
  }
};

/** التحقق من الكود ثم التعيين: الاعتماد الواحد بيتسلسل في العملية، وكل عمليات القاعدة محدودة بالنافذة. */
async function verifyAndReset(
  options: PasswordResetOtpApiOptions,
  database: Database,
  inFlight: Map<string, Promise<void>>,
  input: {
    challengeId: string;
    code: string;
    newPassword: string;
    config: Extract<EmailOtpConfiguration, { state: 'READY' }>;
    deadline: Date;
    settle(): Promise<void>;
  },
): Promise<PasswordResetOutcome> {
  const crypto = createOtpCrypto(input.config.keys);
  let compared = false;
  const gate = installGate(inFlight, input.challengeId);
  try {
    await gate.previous;
    const compare = (challenge: OtpChallenge) => {
      compared = true;
      return crypto.compare(challenge, input.code);
    };
    // الفحص السريع قبل التجزئة البطيئة: كود غلط بيزوّد المحاولات من غير ما نحسب كلمة المرور.
    const checked = await database.verifyPasswordResetOtp(
      input.challengeId,
      compare,
      options.ids.newId(),
      input.deadline,
    );
    if (checked !== 'MATCH') {
      if (!compared) crypto.dummy(input.code);
      options.onOutcome?.('INVALID');
      return { kind: 'invalid' };
    }
    // النافذة بتخلص قبل التجزئة: التجزئة البطيئة بره الـ 200ms والقفل ما بيستناش hashing.
    await input.settle();
    const passwordHash = await options.hasher.hash(input.newPassword);
    const outcome = await database.consumePasswordResetOtp({
      challengeId: input.challengeId,
      passwordHash,
      accountId: options.ids.newId(),
      auditId: options.ids.newId(),
      compare,
      identify: (email) => options.strategies.identifyEmail(email).hash,
    });
    options.onOutcome?.(outcome === 'RESET' ? 'RESET' : 'INVALID');
    return outcome === 'RESET' ? { kind: 'reset' } : { kind: 'invalid' };
  } catch {
    if (!compared) crypto.dummy(input.code);
    options.onOutcome?.('RESET_FAILED');
    return { kind: 'invalid' };
  } finally {
    gate.release();
  }
}
