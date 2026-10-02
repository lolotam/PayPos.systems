import {
  createProviderMessageDigest,
  readOtpTemplateApproval,
  WhatsAppChannel,
} from '@pospay/notifications';
import type { Redis } from 'ioredis';
import type {
  OtpDiagnostics,
  OtpExecution,
  OtpWorkerCapability,
} from './ports/otp-execution.port.ts';
import type { Clock } from './ports/clock.port.ts';
import type { IdGenerator } from './ports/id-generator.port.ts';
import { redisSendAdmission } from './persistence/redis-send-admission.ts';
import { createOtpChannel } from './persistence/otp-channel.adapter.ts';
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
}

export function startStaffOtpWorker(options: StaffOtpWorkerOptions) {
  const adapter = channelFor(options);
  const send = new SendStaffOtp(
    options.auth,
    options.capability,
    redisSendAdmission(options.redis, 1000),
    adapter,
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
    close: async () => {
      await worker.close();
      await options.auth.close();
    },
  };
}

function channelFor(options: StaffOtpWorkerOptions) {
  const approval = readOtpTemplateApproval(options.env);
  if (
    approval === null ||
    options.env['STAFF_OTP_ENABLED'] !== 'true' ||
    options.env['NOTIFICATIONS_MODE'] !== 'live'
  )
    throw new Error('OTP_CAPABILITY_UNAVAILABLE');
  const channel = new WhatsAppChannel({
    accessToken: options.env['WHATSAPP_ACCESS_TOKEN'] ?? '',
    phoneNumberId: options.env['WHATSAPP_PHONE_NUMBER_ID'] ?? '',
    now: () => options.clock.now(),
    beforeSubmit: () => options.capability.ready(),
  });
  const providerIdentity = createProviderMessageDigest(
    options.env['NOTIFICATION_MESSAGE_ID_HASH_KEY'] ?? '',
    options.env['NOTIFICATION_PHONE_HASH_KEY_ID'] ?? '',
  );
  return createOtpChannel(channel, approval, options.capability, providerIdentity, () =>
    options.clock.now(),
  );
}
