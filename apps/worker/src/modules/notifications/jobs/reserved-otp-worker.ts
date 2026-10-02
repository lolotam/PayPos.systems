import { notificationRedisOptions } from '@pospay/notifications';
import { Worker } from 'bullmq';
import type { SendStaffOtp } from '../use-cases/send-staff-otp/send-staff-otp.ts';
import { staffOtpProcessor } from './staff-otp.processor.ts';

export function createReservedOtpWorker(
  send: SendStaffOtp,
  redisUrl: string,
  options: { prefix?: string; onError(): void },
) {
  const worker = new Worker('notifications-otp', staffOtpProcessor(send), {
    connection: notificationRedisOptions(redisUrl),
    concurrency: 4,
    maxStalledCount: 0,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  });
  worker.on('error', () => options.onError());
  worker.on('failed', () => options.onError());
  return worker;
}
