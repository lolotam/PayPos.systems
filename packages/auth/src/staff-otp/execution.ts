import { createStaffOtpDatabase } from '@pospay/db';
import { createOtpCrypto } from './crypto.ts';
import type { OtpConfiguration } from './configuration.ts';
import type { EmailOtpConfiguration } from '../password-reset-otp/configuration.ts';
import type { EmailOtpStrategies, OtpCapability } from './types.ts';

/**
 * واجهة تنفيذ الاعتماد المحصورة: pending وtimeout وclaim وmaterialize وfinish — كلها محدودة
 * ومقفولة بمعرّف الاعتماد ومعرّف التنفيذ، ومفيش عميل خام ولا دليل مستخدمين ولا إصدار جلسات.
 */
export function createStaffOtpExecution(options: {
  databaseUrl: string;
  /** إعداد اعتماد الواتساب — مقفول بتفعيل `STAFF_OTP_ENABLED`. */
  configuration(): OtpConfiguration;
  /** إعداد اعتماد الاسترجاع بالإيميل — مستقل تماماً عن الواتساب (BR-004). */
  emailConfiguration(): EmailOtpConfiguration;
  capability: OtpCapability;
  emailCapability: OtpCapability;
  strategies: EmailOtpStrategies;
}) {
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.strategies.phoneLockKey,
  });
  const ready = async (channel: 'EMAIL' | 'WHATSAPP'): Promise<boolean> =>
    channel === 'EMAIL'
      ? options.emailConfiguration().state === 'READY' && (await options.emailCapability.ready())
      : options.configuration().state === 'READY' && (await options.capability.ready());
  return {
    pending: database.pending,
    timeout: database.timeout,
    claim: (challengeId: string, attemptId: string, executionId: string) =>
      claimWithReadiness(database, ready, [challengeId, attemptId, executionId]),
    materialize: async (challengeId: string, attemptId: string, executionId: string) => {
      const found = await database.materialize(challengeId, attemptId, executionId);
      if (found === null || found.destination === null) return null;
      const identity =
        found.channel === 'EMAIL'
          ? options.strategies.identifyEmail(found.destination)
          : options.strategies.identify(found.destination);
      // الوجهة لازم تفضل زي ما البصمة المحسوبة وقت الطلب: إيميل أو تليفون اتغيّر بعد كده؟ يُرفض.
      if (
        !identity.valid ||
        identity.hashKeyId !== found.challenge.hashKeyId ||
        !Buffer.from(identity.hash).equals(found.challenge.recipientHash)
      )
        return null;
      const config =
        found.channel === 'EMAIL' ? options.emailConfiguration() : options.configuration();
      // مفتاح الإيقاف بعد الحجز لازم يتحترم: القدرة بتتفحص تاني بعد قراءة المحاولة وبره المعاملة.
      if (config.state !== 'READY' || !(await ready(found.channel))) return null;
      try {
        const crypto = createOtpCrypto(config.keys);
        const code = crypto.derive(found.challenge);
        if (!crypto.compare(found.challenge, code)) return null;
        return {
          destination: found.destination,
          code,
          deadline: found.challenge.expiresAt,
          // fence التنفيذ المؤكد — بيتربّط وسم التتبع للمزوّد بالرسالة نفسها.
          executionId,
        };
      } catch {
        return null;
      }
    },
    finish: database.finish,
    /**
     * مصالحة محاولة الاعتماد مع ردّ المزود: بتقفل المحاولة وبتربط بصمة الرسالة.
     * مفيش عميل خام ولا دليل مستخدمين — القدر محصور بجدولَي الاعتماد.
     */
    reconcileAuthAttempt: database.reconcileAuthAttempt,
    readiness: database.ping,
    close: database.close,
  };
}

export type StaffOtpExecution = ReturnType<typeof createStaffOtpExecution>;

/**
 * يحجز المحاولة بعد فحص جاهزية القناتين بره معاملة الحجز: الحجز بيمسك قفل المستلم، ومينفعش
 * يشيل probe بطيء (قاعدة وRedis) جواه — ميزانية STOP 200ms. النتيجتين بتتحسبوا قبل ما نعرف
 * قناة المحاولة، والمعاملة بتقرا النتيجة المحفوظة بس.
 *
 * @param database قاعدة الاعتماد المحصورة
 * @param ready فحص جاهزية قناة واحدة
 * @param ids معرّف الاعتماد والمحاولة والتنفيذ
 * @returns هل اتحجزت المحاولة
 */
async function claimWithReadiness(
  database: ReturnType<typeof createStaffOtpDatabase>,
  ready: (channel: 'EMAIL' | 'WHATSAPP') => Promise<boolean>,
  ids: readonly [challengeId: string, attemptId: string, executionId: string],
): Promise<boolean> {
  const [email, whatsapp] = await Promise.all([ready('EMAIL'), ready('WHATSAPP')]);
  if (!email && !whatsapp) return false;
  return database.claim(...ids, async (channel) => (channel === 'EMAIL' ? email : whatsapp));
}

/** تنظيف الهوية كل ساعة، مستقل عن تفعيل النقل ومفاتيح اشتقاق الرمز؛ لا يمنح أي إذن إرسال. */
export function createStaffOtpMaintenance(options: {
  databaseUrl: string;
  phoneLockKey(hash: Uint8Array): bigint;
  onFailure(): void;
}) {
  const database = createStaffOtpDatabase({
    url: options.databaseUrl,
    phoneLockKey: options.phoneLockKey,
  });
  let stopped = false,
    active: Promise<void> | undefined;
  const run = async () => {
    if (stopped || active !== undefined) return;
    active = (async () => {
      await database.ping();
      if (!stopped) await database.cleanup(100);
    })().finally(() => {
      active = undefined;
    });
    await active;
  };
  const timer = setInterval(() => {
    void run().catch(() => options.onFailure());
  }, 3_600_000);
  timer.unref();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  return {
    run,
    stop,
    readiness: database.ping,
    close: async () => {
      stop();
      await database.close();
      await active?.catch(() => undefined);
    },
  };
}
