import {
  createStaffOtpExecution,
  readEmailOtpConfiguration,
  readStaffOtpConfiguration,
  type EmailOtpConfiguration,
  type EmailOtpStrategies,
  type OtpConfiguration,
  type StaffOtpExecution,
} from '@pospay/auth';
import { systemUuidV7 } from '@pospay/ids';
import {
  createEmailIdentity,
  createPhoneIdentity,
  phoneLockKey,
  readEmailConfiguration,
  readOtpTemplateApproval,
} from '@pospay/notifications';
import type { Logger } from '@pospay/observability';
import type { Redis } from 'ioredis';

import { startStaffOtpWorker } from './modules/notifications/index.ts';
import type { Inbound } from './modules/notifications/index.ts';
import type { AuthAttemptReconciler } from './modules/notifications/persistence/auth-email-feedback.repository.ts';
import type { OtpWorkerCapability } from './modules/notifications/ports/otp-execution.port.ts';
import { closeOptional, optionalWithin } from './shared/optional-capability.ts';

/** عامل الاعتماد: العامل المحجوز على طابور `notifications-otp`. */
export type OtpWorker = ReturnType<typeof startStaffOtpWorker>;

/** حالة تشغيل إرسال الاعتماد: العامل ومؤقّت النشر. */
export interface OtpDeliveryState {
  otp: OtpWorker | undefined;
  timer: NodeJS.Timeout | undefined;
}

/** مدخلات تشغيل إرسال الاعتماد. */
export interface OtpDeliveryInput {
  readonly env: NodeJS.ProcessEnv;
  readonly logger: Logger;
  readonly redis: Redis;
  readonly redisUrl: string;
  readonly stopping: () => boolean;
  /** قراءة إيميل استعادة الموظفة تحت withTenant — مربوطة في الجذر عشان الهوية ما تفتحش جدول الشركة. */
  readonly readRecoveryEmail?: (companyId: string, userId: string) => Promise<string | null>;
}

/**
 * إرسال الاعتماد — القدر الواحد بخدم القناتين: اعتماد الواتساب واعتماد الاسترجاع
 * بالإيميل، كل واحدة بجاهزيتها المستقلة (BR-004).
 */
export interface OtpDelivery {
  /**
   * مصالحة محاولة الاعتماد مع ردّ المزود — الحقن في مصالحة البريد. بتتشد من جذر
   * التركيب قبل ما مصالحة بريد الشركات تشتغل (ADR-0019). لو الهوية لسه ما اتبنتش
   * بترفض بسبب ثابت فالصف بيتحجر بدل ما يتسوّى غلط.
   */
  readonly reconciler: AuthAttemptReconciler;
  /**
   * واجهة الهوية المحصورة — العامل المحجوز بيقفلها مع نفسه. مش بتتبني غير لما قناة
   * واحدة على الأقل تكون قابلة للتشغيل: من غير قنوات مفيش اتصال بقاعدة الهوية.
   */
  readonly auth: StaffOtpExecution | undefined;
  /**
   * بيشغّل العامل المحجوز وينشر بصمة إعداد كل قناة في Redis.
   *
   * @param inbound استقبال الواتساب — غير موجود لما قناة الواتساب مقفولة
   * @returns حالة العامل
   */
  start(inbound: Inbound | undefined): Promise<OtpDeliveryState>;
}

/** مفتاح نشر بصمة إعداد اعتماد الواتساب في Redis. */
const STAFF_FINGERPRINT_KEY = 'staff-otp:worker-capability';
/** مفتاح نشر بصمة إعداد اعتماد الاسترجاع بالإيميل في Redis. */
const EMAIL_FINGERPRINT_KEY = 'email-otp:worker-capability';

/**
 * يبني قدر إرسال الاعتماد. الجذر بيملكه (ADR-0019) عشان مصالحة البريد تشوف
 * واجهة الهوية نفسها من غير pool تاني.
 *
 * @param input مدخلات التشغيل
 * @returns القدر الجاهز للتشغيل
 */
export function createOtpDelivery(input: OtpDeliveryInput): OtpDelivery {
  const staffConfiguration = () =>
    readStaffOtpConfiguration(input.env, 'worker', readOtpTemplateApproval(input.env));
  const emailConfiguration = () => readEmailOtpConfiguration(input.env);
  const state: DeliveryState = { inbound: undefined, auth: undefined, abandoned: false };
  const channels = deliveryChannels(input, state, staffConfiguration, emailConfiguration);
  const openAuth = () =>
    (state.auth ??= createStaffOtpExecution({
      databaseUrl: input.env['AUTH_DATABASE_URL'] ?? '',
      configuration: staffConfiguration,
      emailConfiguration,
      capability: channels.whatsapp,
      emailCapability: channels.email,
      strategies: otpStrategies(input.env),
      ...(input.readRecoveryEmail === undefined
        ? {}
        : { readRecoveryEmail: input.readRecoveryEmail }),
    }));
  return {
    reconciler: authReconciler(state),
    get auth() {
      return state.auth;
    },
    start: async (received: Inbound | undefined) => {
      state.abandoned = false;
      state.inbound = received;
      const whatsappUsable = received !== undefined && staffConfiguration().state === 'READY';
      const emailUsable =
        readEmailConfiguration(input.env).enabled && emailConfiguration().state === 'READY';
      if (!whatsappUsable && !emailUsable) return startOtpDelivery(input, state, undefined);
      return startOtpDelivery(input, state, {
        staffConfiguration,
        emailConfiguration,
        whatsappUsable,
        emailUsable,
        ...channels,
        auth: openAuth(),
      });
    },
  };
}

/** قنوات الجاهزية: الواتساب والإيميل، كل واحدة لها فحصها وإعدادها المستقل. */
function deliveryChannels(
  input: OtpDeliveryInput,
  state: DeliveryState,
  staffConfiguration: () => OtpConfiguration,
  emailConfiguration: () => EmailOtpConfiguration,
): { whatsapp: OtpWorkerCapability; email: OtpWorkerCapability } {
  const active = () => !state.abandoned && !input.stopping();
  const probeCore = async () => {
    await state.auth?.readiness();
    await input.redis.ping();
  };
  return {
    whatsapp: channelCapability({
      name: 'STAFF_LOGIN',
      logger: input.logger,
      configured: () =>
        active() && state.inbound !== undefined && staffConfiguration().state === 'READY',
      probe: async () => {
        await state.inbound?.ready();
        await probeCore();
      },
    }),
    email: channelCapability({
      name: 'EMAIL_OTP',
      logger: input.logger,
      configured: () =>
        active() &&
        readEmailConfiguration(input.env).enabled &&
        emailConfiguration().state === 'READY',
      probe: probeCore,
    }),
  };
}

/** الموارد اللي بتتبني متأخرة: استقبال الواتساب، وواجهة الهوية بعد ما قناة تبقى قابلة للتشغيل. */
interface DeliveryState {
  inbound: Inbound | undefined;
  auth: StaffOtpExecution | undefined;
  abandoned: boolean;
}

/**
 * مصالحة ردّ المزود: لو الهوية لسه ما اتبنتش (إقلاع العامل أو تأخّر القناة) الردّ ما يتحجرش
 * للأبد — الفشل بيتعامل كعطل مؤقت والصندوق بيجدول إعادة المحاولة، والتحجير بيحصل بس لو
 * الاستنفاد انتهى. الرفض الثابت EXECUTION_MISSING بيفضل لتعارض معرّف التنفيذ الحقيقي.
 */
function authReconciler(state: DeliveryState): AuthAttemptReconciler {
  return {
    reconcileAuthAttempt: async (attempt) => {
      if (state.auth === undefined) throw new Error('AUTH_EXECUTION_NOT_READY');
      return state.auth.reconcileAuthAttempt(attempt);
    },
  };
}

/** بصمات القناتين: مفتاح غايب بيقفل قناته بس، ومش بيوقّع العامل وقت الإقلاع. */
function otpStrategies(env: NodeJS.ProcessEnv): EmailOtpStrategies {
  const refused = { hash: new Uint8Array(32), hashKeyId: '', last3: '', valid: false };
  return {
    identify: tolerantIdentity(
      () =>
        createPhoneIdentity(
          env['NOTIFICATION_PHONE_HASH_KEY'] ?? '',
          env['NOTIFICATION_PHONE_HASH_KEY_ID'] ?? '',
        ).identify,
      refused,
    ),
    phoneLockKey,
    identifyEmail: tolerantIdentity(
      () =>
        createEmailIdentity(
          env['NOTIFICATION_EMAIL_HASH_KEY'] ?? '',
          env['NOTIFICATION_EMAIL_HASH_KEY_ID'] ?? '',
        ).identify,
      refused,
    ),
  };
}

/**
 * هوية مقاومة لغياب المفتاح: لو بناء الهوية فشل (مفتاح ناقص أو معرّف مش صالح) كل بصمة
 * بترجع غير صالحة، فالتنفيذ بيرفض الإرسال بدل ما العامل كله يقع وقت الإقلاع.
 *
 * @param create يبني دالة البصمة من البيئة
 * @param refused البصمة غير الصالحة اللي بترجع بدل الفشل
 * @returns دالة بصمة بتفشل مغلقة
 */
function tolerantIdentity<I extends { valid: boolean }>(
  create: () => (value: string) => I,
  refused: I,
): (value: string) => I {
  let identify: ((value: string) => I) | undefined;
  return (value: string): I => {
    try {
      identify ??= create();
      return identify(value);
    } catch {
      return refused;
    }
  };
}

/** خطة التشغيل: إعدادات كل قناة جاهزية ومستقلة. */
interface OtpDeliveryPlan {
  staffConfiguration(): OtpConfiguration;
  emailConfiguration(): EmailOtpConfiguration;
  whatsappUsable: boolean;
  emailUsable: boolean;
  whatsapp: OtpWorkerCapability;
  email: OtpWorkerCapability;
  auth: StaffOtpExecution;
}

/**
 * يبدأ إرسال الاعتماد: قناة الواتساب وقناة الإيميل، كل واحدة بجاهزيتها المستقلة.
 * مفيش قناة جاهزة ⇒ مفيش عامل، من غير ما الخدمة تترجع.
 */
async function startOtpDelivery(
  input: OtpDeliveryInput,
  state: DeliveryState,
  plan: OtpDeliveryPlan | undefined,
): Promise<OtpDeliveryState> {
  const started: OtpDeliveryState = { otp: undefined, timer: undefined };
  if (plan === undefined) {
    input.logger.info(
      { capability: { name: 'STAFF_LOGIN', state: 'DISABLED' } },
      'staff OTP capability',
    );
    return started;
  }
  try {
    await openOtpDelivery(input, plan, started);
  } catch {
    await abandonOtpDelivery(started, state, input.logger);
  }
  input.logger.info(
    {
      capability: {
        name: 'STAFF_LOGIN',
        state: started.otp === undefined ? 'UNAVAILABLE' : 'READY',
      },
    },
    'staff OTP capability',
  );
  return started;
}

/** يجهّز العامل المحجوز وينشر بصمة كل قناة. */
async function openOtpDelivery(
  input: OtpDeliveryInput,
  plan: OtpDeliveryPlan,
  started: OtpDeliveryState,
): Promise<void> {
  // القدرة العامة جاهزة لو أي قناة جاهزة: اعتماد الإيميل بيشتغل من غير اعتماد الواتساب.
  const combined: OtpWorkerCapability = {
    available: () => plan.whatsapp.available() || plan.email.available(),
    ready: async () => (await plan.whatsapp.ready()) || (await plan.email.ready()),
  };
  const otp = startStaffOtpWorker({
    env: input.env,
    auth: plan.auth,
    capability: combined,
    whatsappCapability: plan.whatsappUsable ? plan.whatsapp : undefined,
    emailCapability: plan.emailUsable ? plan.email : undefined,
    redis: input.redis,
    redisUrl: input.redisUrl,
    clock: { now: () => new Date() },
    ids: systemUuidV7(),
    diagnostics: {
      record: (outcome) =>
        input.logger.info(
          { capability: { name: 'STAFF_LOGIN', outcome } },
          'staff OTP execution outcome',
        ),
    },
  });
  started.otp = otp;
  await optionalWithin(() => plan.auth.readiness());
  await optionalWithin(() => otp.ready());
  const publish = publishCapability(input.redis, [
    {
      key: STAFF_FINGERPRINT_KEY,
      fingerprint: plan.whatsappUsable ? fingerprintOf(plan.staffConfiguration()) : null,
      ready: plan.whatsapp.ready,
    },
    {
      key: EMAIL_FINGERPRINT_KEY,
      fingerprint: plan.emailUsable ? fingerprintOf(plan.emailConfiguration()) : null,
      ready: plan.email.ready,
    },
  ]);
  if (!(await publish())) throw new Error('OPTIONAL_CAPABILITY_UNAVAILABLE');
  started.timer = watchCapability(publish, input.logger);
}

/** بصمة الإعداد: العامل والـ API لازم يتكلموا عن نفس المفاتيح. */
function fingerprintOf(configuration: OtpConfiguration | EmailOtpConfiguration): string | null {
  return configuration.state === 'READY' ? configuration.fingerprint : null;
}

/** قدرة قناة واحدة: جاهزيتها مش بتأثر على القناة التانية. */
function channelCapability(input: {
  name: string;
  logger: Logger;
  configured(): boolean;
  probe(): Promise<void>;
}): OtpWorkerCapability {
  let healthy = false;
  let wasReady: boolean | undefined;
  const report = (ready: boolean) => {
    if (ready !== wasReady)
      input.logger.info(
        { capability: { name: input.name, state: ready ? 'READY' : 'UNAVAILABLE' } },
        'staff OTP capability',
      );
    wasReady = ready;
    return ready;
  };
  return {
    available: () => report(healthy && input.configured()),
    ready: async () => {
      if (!input.configured()) {
        healthy = false;
        return report(false);
      }
      try {
        await optionalWithin(() => input.probe());
        healthy = true;
      } catch {
        healthy = false;
      }
      return report(healthy && input.configured());
    },
  };
}

/** ينشر بصمة الإعداد لكل قناة، فالعامل والـ API بيتأكدوا من نفس الإعداد. */
function publishCapability(
  redis: Redis,
  channels: readonly { key: string; fingerprint: string | null; ready(): Promise<boolean> }[],
) {
  return async () => {
    const states = await Promise.all(
      channels.map(async (channel) => ({
        channel,
        ready: channel.fingerprint === null ? false : await channel.ready(),
      })),
    );
    await optionalWithin(async () => {
      for (const { channel, ready } of states)
        if (ready && channel.fingerprint !== null)
          await redis.set(channel.key, channel.fingerprint, 'PX', 3000);
        else await redis.del(channel.key);
    });
    return states.some((state) => state.ready);
  };
}

/** يراقب النشر كل ثانية ويموت بصمت إن القدر ضاع. */
function watchCapability(publish: () => Promise<boolean>, logger: Logger) {
  return setInterval(() => {
    void publish().catch(() =>
      logger.warn(
        {
          capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE', reason: 'PUBLISH_FAILED' },
        },
        'staff OTP capability',
      ),
    );
  }, 1000);
}

/** بيتقفل العامل ساعة التوقف: مفيش تنفيذ باقى شغال. */
async function abandonOtpDelivery(
  started: OtpDeliveryState,
  state: DeliveryState,
  logger: Logger,
): Promise<void> {
  logger.warn(
    { capability: { name: 'STAFF_LOGIN', state: 'UNAVAILABLE', reason: 'SETUP_FAILED' } },
    'staff OTP capability',
  );
  clearInterval(started.timer);
  state.abandoned = true;
  const failedWorker = started.otp;
  const failedAuth = state.auth;
  started.otp = undefined;
  started.timer = undefined;
  state.auth = undefined;
  await closeOptional([() => failedWorker?.close(true), () => failedAuth?.close()]);
}
