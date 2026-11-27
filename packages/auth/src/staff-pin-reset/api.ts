import {
  createStaffOtpDatabase,
  type EmailResetPreparation,
  type StaffPinResetContext,
} from '@pospay/db';
import type { EmailOtpConfiguration } from '../password-reset-otp/configuration.ts';
import type { OtpConfiguration } from '../staff-otp/configuration.ts';
import { createOtpCrypto } from '../staff-otp/crypto.ts';
import type {
  EmailOtpStrategies,
  OtpCapability,
  OtpChallenge,
  OtpRates,
  OtpSender,
  StaffDeviceContext,
  StaffEligibility,
} from '../staff-otp/types.ts';

/** صلاحية اعتماد استرجاع الرقم السري: عشرة دقايق من وقت القبول، مش من وقت الإرسال. */
export const STAFF_PIN_RESET_LIFETIME_MS = 600_000;
/** نافذة إعادة الطلب: الموظفة تقدر تطلب كود جديد بعد دقيقة. */
export const STAFF_PIN_RESET_RETRY_MS = 60_000;
/** نافذة التحضير الثابتة: الردّ الموحّد بيستنى لحد نهايتها مهما كانت النتيجة. */
const WINDOW_MS = 200;

/** قناة استرجاع الرقم السري اللي بيختارها الموظف. */
export type StaffPinResetChannel = 'EMAIL' | 'WHATSAPP';

/** نتيجة طلب الكود: مقبول أو محدود أو غير متاح. */
export type StaffPinResetRequestResult =
  | { readonly kind: 'accepted'; readonly challengeId: string }
  | { readonly kind: 'limited'; readonly retryAfter: number }
  | { readonly kind: 'unavailable' };

/** نتيجة تعيين الرقم الجديد. */
export type StaffPinResetResult =
  | { readonly kind: 'reset' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'limited'; readonly retryAfter: number }
  | { readonly kind: 'unavailable' };

/** قراءة ضيقة تحت withTenant لشركة الجهاز: بتربط الإيميل المسجل بموظف واحد بصلاحية دخول سارية. */
export interface StaffRecoveryReader {
  /**
   * يرجّع صاحب حساب الدخول لو فيه موظف واحد بالضبط غير محذوف بنفس إيميل الاستعادة وبصلاحية دخول
   * سارية؛ أي عدد تاني من الصفوف بيرجّع null (فشل مغلق).
   *
   * @param device الجهاز المتحقق: الشركة منه مش من الطلب
   * @param email الإيميل المطبّع
   */
  userByEmail(device: StaffDeviceContext, email: string): Promise<string | null>;
}

/** كتابة الرقم الجديد تحت قفل الشركة: التجزئة بره المعاملة، والتحقق من الإيميل جواها. */
export interface StaffPinWriter {
  /**
   * يجزّئ الرقم قبل أي قفل: التجزئة البطيئة ما تمسكش اتصال.
   *
   * @param pin الرقم الجديد بعد فحص شكله
   */
  hash(pin: string): Promise<string>;
  /**
   * يعيد فحص الأهلية ويدوّر الرقم لرقم دائم في معاملة واحدة، ويرجّع هل اتغيّر فعلاً.
   *
   * @param input الجهاز وصاحب الرقم والتجزئة والتحقق من إيميل الاستعادة الحالي
   */
  apply(input: {
    readonly device: StaffDeviceContext;
    readonly userId: string;
    readonly hash: string;
    readonly channel: StaffPinResetChannel;
    readonly emailMatches: (email: string | null) => boolean;
  }): Promise<boolean>;
}

/** خيارات خدمة استرجاع الرقم السري. */
export interface StaffPinResetApiOptions {
  readonly databaseUrl: string;
  /** مفاتيح الرمز وجاهزية الإيميل: نفس مفاتيح استرجاع كلمة المرور، مستقلة عن الواتساب. */
  emailConfiguration(): EmailOtpConfiguration;
  /** جاهزية الواتساب: اعتماد الموظفين مفعّل وقالب الاسترجاع معتمد. */
  whatsappConfiguration(): OtpConfiguration;
  readonly capability: Readonly<Record<StaffPinResetChannel, OtpCapability>>;
  readonly rates: OtpRates;
  readonly sender: OtpSender;
  readonly strategies: EmailOtpStrategies;
  readonly eligibility: StaffEligibility;
  readonly recovery: StaffRecoveryReader;
  readonly pins: StaffPinWriter;
  readonly ids: { newId(): string };
  readonly clock: { now(): Date; waitUntil(deadline: Date): Promise<void> };
  onOutcome?: (outcome: string) => void;
}

type Database = ReturnType<typeof createStaffOtpDatabase>;
type Ready = Extract<EmailOtpConfiguration, { state: 'READY' }>;

/**
 * خدمة استرجاع الرقم السري للموظف بكود 6 أرقام على الإيميل أو الواتساب. كل نتيجة طلب بتتردّ
 * بنفس الشكل وبنفس نافذة الـ 200ms، فالرد ما بيكشفش وجود الموظف ولا حالته ولا قناته.
 *
 * @param options الأدوات المحقونة من جذر التركيب
 * @returns الطلب والتعيين والجاهزية والإغلاق
 */
export function createStaffPinResetApi(options: StaffPinResetApiOptions) {
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.strategies.phoneLockKey,
  });
  return {
    request: (input: RequestInput) => request(options, database, input),
    reset: (input: ResetInput) => reset(options, database, input),
    readiness: () => database.ping(),
    close: () => database.close(),
  };
}

export type StaffPinResetApi = ReturnType<typeof createStaffPinResetApi>;

interface RequestInput {
  readonly channel: StaffPinResetChannel;
  readonly identifier: string;
  readonly locale: 'ar' | 'en';
  readonly ip: string;
  readonly device: StaffDeviceContext;
}

interface ResetInput {
  readonly challengeId: string;
  readonly code: string;
  readonly pin: string;
  readonly ip: string;
  readonly device: StaffDeviceContext;
}

const contextOf = (device: StaffDeviceContext, channel: StaffPinResetChannel) =>
  ({ purpose: 'STAFF_PIN_RESET', ...device, channel }) satisfies StaffPinResetContext;

/** القناة جاهزة: إعدادها مكتمل وقدرتها سليمة (الإيميل مستقل عن الواتساب). */
async function channelReady(
  options: StaffPinResetApiOptions,
  channel: StaffPinResetChannel,
  deadline?: Date,
): Promise<Ready | null> {
  try {
    const config =
      channel === 'EMAIL' ? options.emailConfiguration() : options.whatsappConfiguration();
    if (config.state !== 'READY') return null;
    if (!(await options.capability[channel].ready(deadline))) return null;
    // مفاتيح الرمز واحدة للقناتين؛ بصمة الإيميل بتتحقق بعدين من الإعداد المشترك.
    const keys = options.emailConfiguration();
    return keys.state === 'READY' ? keys : null;
  } catch {
    return null;
  }
}

/** الإيميل المطبّع الوحيد اللي بيتقارن ويتبصم: حروف صغيرة وبلا مسافات. */
const canonicalEmail = (identifier: string): string => identifier.trim().toLowerCase();

/** يشغّل القراءة تحت موعد النافذة؛ اللي يتأخر أو يفشل يتعامل كأنه مفيش نتيجة. */
function within<T>(
  clock: { now(): Date },
  deadline: Date,
  work: () => Promise<T>,
): Promise<T | null> {
  const left = Math.max(0, deadline.getTime() - clock.now().getTime());
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), left);
    work().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** صاحب الحساب المؤهل للقناة: القراءة والأهلية تحت نفس النافذة، وأي فشل بيتعامل كغير مؤهل. */
async function eligibleUser(
  options: StaffPinResetApiOptions,
  database: Database,
  input: RequestInput,
  deadline: Date,
): Promise<string | null> {
  const email = canonicalEmail(input.identifier);
  const userId = await within(options.clock, deadline, () =>
    input.channel === 'EMAIL'
      ? options.recovery.userByEmail(input.device, email)
      : database.lookup(input.identifier, deadline),
  );
  if (userId === null) return null;
  const ok = await within(options.clock, deadline, async () => {
    const [valid, eligible] = await Promise.all([
      options.eligibility.deviceValid(input.device, deadline),
      options.eligibility.eligible(userId, input.device, deadline),
    ]);
    return valid && eligible;
  });
  return ok === true ? userId : null;
}

async function request(
  options: StaffPinResetApiOptions,
  database: Database,
  input: RequestInput,
): Promise<StaffPinResetRequestResult> {
  const config = await channelReady(options, input.channel);
  if (config === null) {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  const identity =
    input.channel === 'EMAIL'
      ? options.strategies.identifyEmail(canonicalEmail(input.identifier))
      : options.strategies.identify(input.identifier);
  const ids = { challengeId: options.ids.newId(), attemptId: options.ids.newId() };
  let rate: number;
  try {
    rate = await options.rates.request(identity.hash, input.ip, ids.challengeId);
  } catch {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  if (rate > 0) return { kind: 'limited', retryAfter: rate };
  const createdAt = options.clock.now();
  const deadline = new Date(createdAt.getTime() + WINDOW_MS);
  try {
    if (identity.valid) {
      const userId = await eligibleUser(options, database, input, deadline);
      await prepareAndDeliver(options, database, {
        config,
        identity,
        input,
        userId,
        ids,
        createdAt,
        deadline,
      });
    } else options.onOutcome?.('NOT_AUTHORIZED');
  } catch {
    options.onOutcome?.('PREPARATION_FAILED');
  }
  // نفس النافذة لكل حالة: ما يبانش موظف موجود ولا مؤهل ولا محظور.
  await options.clock.waitUntil(deadline);
  return { kind: 'accepted', challengeId: ids.challengeId };
}

interface Preparation {
  readonly config: Ready;
  readonly identity: ReturnType<EmailOtpStrategies['identifyEmail']>;
  readonly input: RequestInput;
  readonly userId: string | null;
  readonly ids: { challengeId: string; attemptId: string };
  readonly createdAt: Date;
  readonly deadline: Date;
}

/** يبني صف الاعتماد والمحاولة بنفس الموعد: الصلاحية عشر دقايق من وقت القبول، والكود يتحسب جوه القفل. */
function preparationOf(
  options: StaffPinResetApiOptions,
  p: Preparation,
  context: StaffPinResetContext,
): EmailResetPreparation {
  const expiresAt = new Date(p.createdAt.getTime() + STAFF_PIN_RESET_LIFETIME_MS);
  const challenge: OtpChallenge = {
    id: p.ids.challengeId,
    recipientHash: p.identity.hash,
    hashKeyId: p.identity.hashKeyId,
    userId: null,
    deviceContext: context,
    codeMac: null,
    derivationKeyId: p.config.keys.derivationId,
    verificationKeyId: p.config.keys.verificationId,
    status: 'ACTIVE',
    failedAttempts: 0,
    createdAt: p.createdAt,
    expiresAt,
  };
  const crypto = createOtpCrypto(p.config.keys);
  const whatsapp = options.whatsappConfiguration();
  return {
    challengeId: p.ids.challengeId,
    attemptId: p.ids.attemptId,
    recipientHash: p.identity.hash,
    hashKeyId: p.identity.hashKeyId,
    userId: p.userId,
    locale: p.input.locale,
    createdAt: p.createdAt,
    expiresAt,
    preparationDeadline: p.deadline,
    derivationKeyId: p.config.keys.derivationId,
    verificationKeyId: p.config.keys.verificationId,
    eligible: p.userId !== null,
    auditId: options.ids.newId(),
    materializeMac: () => crypto.mac(challenge, crypto.derive(challenge)),
    staffPin: {
      context,
      providerTemplateName:
        p.input.channel === 'WHATSAPP' && whatsapp.state === 'READY'
          ? whatsapp.templates[p.input.locale]
          : null,
    },
  };
}

/** يجهّز الاعتماد، وبعد نجاح التحضير يسلّمه للطابور ويفرج عنه. */
async function prepareAndDeliver(
  options: StaffPinResetApiOptions,
  database: Database,
  p: Preparation,
): Promise<void> {
  const context = contextOf(p.input.device, p.input.channel);
  const prepared = await database.prepareEmailResetChallenge(preparationOf(options, p, context));
  if (prepared !== 'PREPARED') {
    options.onOutcome?.('NOT_AUTHORIZED');
    return;
  }
  try {
    await options.sender.enqueue(
      { challengeId: p.ids.challengeId, attemptId: p.ids.attemptId },
      p.deadline,
    );
  } catch {
    options.onOutcome?.('ENQUEUE_FAILED');
    await database
      .failPreparation(p.ids.challengeId, p.ids.attemptId, p.deadline)
      .catch(() => undefined);
    return;
  }
  // الإرسال بيتأذن بعد ما الطابور يقبل المهمة، وبعد فحص جاهزية القناة تاني جوّه القفل.
  const authorized = await database
    .release(p.ids.challengeId, p.ids.attemptId, p.deadline, () =>
      options.capability[p.input.channel].ready(p.deadline),
    )
    .catch(() => false);
  options.onOutcome?.(authorized ? 'AUTHORIZED' : 'NOT_AUTHORIZED');
}

async function reset(
  options: StaffPinResetApiOptions,
  database: Database,
  input: ResetInput,
): Promise<StaffPinResetResult> {
  let rate: number;
  try {
    rate = await options.rates.verify(input.challengeId, input.ip);
  } catch {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  const deadline = new Date(options.clock.now().getTime() + WINDOW_MS);
  let settled = false;
  const settle = async () => {
    if (settled) return;
    settled = true;
    await options.clock.waitUntil(deadline);
  };
  try {
    if (rate > 0) return { kind: 'limited', retryAfter: rate };
    return await verifyAndApply(options, database, input, deadline, settle);
  } finally {
    await settle();
  }
}

/** الفحص السريع، ثم انتظار النافذة، ثم التجزئة البطيئة والاستهلاك والكتابة. */
async function verifyAndApply(
  options: StaffPinResetApiOptions,
  database: Database,
  input: ResetInput,
  deadline: Date,
  settle: () => Promise<void>,
): Promise<StaffPinResetResult> {
  const keys = options.emailConfiguration();
  const found = await database.find(input.challengeId, deadline).catch(() => null);
  const channel =
    found !== null && 'channel' in found.deviceContext ? found.deviceContext.channel : null;
  if (channel === null) {
    options.onOutcome?.('INVALID');
    return { kind: 'invalid' };
  }
  if (keys.state !== 'READY' || (await channelReady(options, channel, deadline)) === null) {
    options.onOutcome?.('UNAVAILABLE');
    return { kind: 'unavailable' };
  }
  const crypto = createOtpCrypto(keys.keys);
  const context = contextOf(input.device, channel);
  let compared = false;
  const compare = (challenge: OtpChallenge) => {
    compared = true;
    return crypto.compare(challenge, input.code);
  };
  try {
    const checked = await database.verifyStaffPinResetOtp(
      input.challengeId,
      context,
      compare,
      options.ids.newId(),
      deadline,
    );
    if (checked !== 'MATCH') {
      if (!compared) crypto.dummy(input.code);
      options.onOutcome?.('INVALID');
      return { kind: 'invalid' };
    }
    // النافذة بتخلص قبل التجزئة: التجزئة البطيئة بره الـ 200ms والقفل ما بيستناش hashing.
    await settle();
    const applied = await consume(options, database, { ...input, context, compare });
    options.onOutcome?.(applied ? 'RESET' : 'INVALID');
    return applied ? { kind: 'reset' } : { kind: 'invalid' };
  } catch {
    if (!compared) crypto.dummy(input.code);
    options.onOutcome?.('RESET_FAILED');
    return { kind: 'invalid' };
  }
}

/**
 * الاستهلاك أولاً ثم الكتابة: الاعتمادين على roles مختلفة فمفيش معاملة واحدة بيناهم، فالكود
 * بيتحرق قبل أي كتابة، وفشل الكتابة بعده يخلي الموظف يطلب كوداً جديداً بدل ما الكود يتعاد.
 */
async function consume(
  options: StaffPinResetApiOptions,
  database: Database,
  input: ResetInput & {
    context: StaffPinResetContext;
    compare: (challenge: OtpChallenge) => boolean;
  },
): Promise<boolean> {
  const { device, context } = input;
  const found = await database.find(input.challengeId);
  if (found?.userId == null) return false;
  if (
    !(await options.eligibility.deviceValid(device)) ||
    !(await options.eligibility.eligible(found.userId, device))
  )
    return false;
  const hash = await options.pins.hash(input.pin);
  const consumed = await database.consumeStaffPinResetOtp({
    challengeId: input.challengeId,
    device: context,
    compare: input.compare,
  });
  if (consumed === null) return false;
  const identifyPhone = (phone: string) => options.strategies.identify(phone).hash;
  if (
    context.channel === 'WHATSAPP' &&
    !(await database.mappingValid(consumed.userId, consumed.recipientHash, identifyPhone))
  )
    return false;
  const applied = await options.pins.apply({
    device,
    userId: consumed.userId,
    hash,
    channel: context.channel,
    emailMatches: (email) =>
      email !== null &&
      Buffer.from(options.strategies.identifyEmail(email).hash).equals(consumed.recipientHash),
  });
  // الرقم اتغيّر فعلاً: فشل سجل المنصة بعده ما يرجّعش النجاح، بس بيتبلّغ للتشغيل.
  if (applied)
    await database
      .recordStaffPinReset(options.ids.newId(), consumed.userId)
      .catch(() => options.onOutcome?.('AUDIT_FAILED'));
  return applied;
}
