import type { OtpSender } from '@pospay/auth';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

export function createOtpSender(url: string) {
  const connection = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: 30,
    lazyConnect: true,
  });
  connection.on('error', () => undefined);
  const queue = new Queue('notifications-otp', { connection });
  const sender: OtpSender = {
    enqueue: async ({ challengeId, attemptId }, deadline) => {
      if (Date.now() + 30 >= deadline.getTime() || connection.status !== 'ready')
        throw new Error('OTP_ENQUEUE_UNAVAILABLE');
      // مهلة الاتصال تقطع انتظار الرد؛ لا إعادة محاولة ولا promise تمتد بعد الرد.
      try {
        await queue.add(
          'staff-otp',
          { challenge_id: challengeId, attempt_id: attemptId },
          {
            jobId: `staff-otp-${challengeId}-${attemptId}`,
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      } catch {
        connection.disconnect();
        await queue.close();
        throw new Error('OTP_ENQUEUE_UNKNOWN');
      }
      if (Date.now() >= deadline.getTime()) throw new Error('OTP_ENQUEUE_UNKNOWN');
    },
  };
  return {
    sender,
    ready: async () => {
      if (connection.status !== 'ready') throw new Error('OTP_ENQUEUE_UNAVAILABLE');
      await queue.waitUntilReady();
      await connection.ping();
    },
    workerFingerprint: async (deadline?: Date) => {
      if (
        connection.status !== 'ready' ||
        (deadline !== undefined && Date.now() + 40 >= deadline.getTime())
      )
        return null;
      return connection.get('staff-otp:worker-capability');
    },
    close: async () => {
      connection.disconnect();
      await queue.close();
    },
  };
}
