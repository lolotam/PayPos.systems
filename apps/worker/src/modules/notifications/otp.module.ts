import {
  createProviderMessageDigest,
  readEmailConfiguration,
  readOtpTemplateApproval,
  ResendChannel,
  WhatsAppChannel,
} from '@pospay/notifications';
import type { Redis } from 'ioredis';
import type {
  OtpChannel,
  OtpDiagnostics,
  OtpExecution,
  OtpWorkerCapability,
} from './ports/otp-execution.port.ts';
import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import { redisSendAdmission } from './persistence/redis-send-admission.ts';
import { createOtpChannel } from './persistence/otp-channel.adapter.ts';
import { createEmailOtpChannel } from './persistence/otp-email-channel.adapter.ts';
import { SendStaffOtp } from './use-cases/send-staff-otp/send-staff-otp.ts';
import { createReservedOtpWorker } from './jobs/reserved-otp-worker.ts';

/** هذا wiring محصور في المصادقة، ولا يفتح قناة الإرسال الخاصة بالشركات. */
interface StaffOtpWorkerOptions {
  env: NodeJS.ProcessEnv;
  auth: OtpExecution;
  capability: OtpWorkerCapability;
  redis: Redis;
  redisUrl: string;
  clock: Clock;
  ids: IdGenerator;
  diagnostics: OtpDiagnostics;
  /** جاهزية اعتماد الواتساب — مستقلة عن قناة الإيميل. */
  whatsappCapability?: OtpWorkerCapability | undefined;
  /** جاهزية اعتماد الاسترجاع بالإيميل — مستقلة عن اعتماد الواتساب (BR-004). */
  emailCapability?: OtpWorkerCapability | undefined;
}

export function startStaffOtpWorker(options: StaffOtpWorkerOptions) {
  const channels = channelsFor(options);
  // بلا قناة واحدة مفيش إرسال: العامل بيقف بدل ما يطلب اعتماد ما حدش بيبعته.
  if (channels.length === 0) throw new Error('OTP_CAPABILITY_UNAVAILABLE');
  const send = new SendStaffOtp(
    options.auth,
    options.capability,
    redisSendAdmission(options.redis, 1000),
    channels,
    options.clock,
    options.ids,
    { pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) },
    options.diagnostics,
  );
  const worker = createReservedOtpWorker(send, options.redisUrl, {
    onError: () => options.diagnostics.record('WORKER_ERROR'),
  });
  return {
    ready: async () => {
      await worker.waitUntilReady();
    },
    stop: async () => {
      await worker.pause(true);
    },
    close: async (force = false) => {
      await worker.close(force);
      await options.auth.close();
    },
  };
}

/** القنوات المتاحة: كل قناة جاهزة لوحدها، وأي واحدة منهم بتكفي لبدء العامل. */
function channelsFor(options: StaffOtpWorkerOptions): OtpChannel[] {
  const channels: OtpChannel[] = [];
  const whatsapp = whatsappChannel(options);
  if (whatsapp !== null) channels.push(whatsapp);
  const email = emailChannel(options);
  if (email !== null) channels.push(email);
  return channels;
}

/** قناة اعتماد الواتساب: مقفولة إلا بتفعيل `STAFF_OTP_ENABLED` واعتماد القالب. */
function whatsappChannel(options: StaffOtpWorkerOptions): OtpChannel | null {
  const approval = readOtpTemplateApproval(options.env);
  const capability = options.whatsappCapability;
  if (
    approval === null ||
    capability === undefined ||
    options.env['STAFF_OTP_ENABLED'] !== 'true' ||
    options.env['NOTIFICATIONS_MODE'] !== 'live'
  )
    return null;
  try {
    const channel = new WhatsAppChannel({
      accessToken: options.env['WHATSAPP_ACCESS_TOKEN'] ?? '',
      phoneNumberId: options.env['WHATSAPP_PHONE_NUMBER_ID'] ?? '',
      now: () => options.clock.now(),
      beforeSubmit: () => capability.ready(),
    });
    const providerIdentity = createProviderMessageDigest(
      options.env['NOTIFICATION_MESSAGE_ID_HASH_KEY'] ?? '',
      options.env['NOTIFICATION_PHONE_HASH_KEY_ID'] ?? '',
    );
    return createOtpChannel(channel, approval, capability, providerIdentity, () =>
      options.clock.now(),
    );
  } catch {
    return null;
  }
}

/** قناة اعتماد الاسترجاع بالإيميل: شغالة لو قناة البريد جاهزة، ومن غير اعتماد الواتساب. */
function emailChannel(options: StaffOtpWorkerOptions): OtpChannel | null {
  const capability = options.emailCapability;
  if (capability === undefined) return null;
  const configuration = readEmailConfiguration(options.env);
  if (!configuration.enabled) return null;
  try {
    const channel = new ResendChannel({
      now: () => options.clock.now(),
      env: options.env,
    });
    const providerIdentity = createProviderMessageDigest(
      options.env['NOTIFICATION_MESSAGE_ID_HASH_KEY'] ?? '',
      options.env['NOTIFICATION_EMAIL_HASH_KEY_ID'] ?? '',
    );
    return createEmailOtpChannel(channel, capability, providerIdentity, () => options.clock.now());
  } catch {
    return null;
  }
}
