import type { OtpSender } from '@pospay/auth';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

function connect(url: string) {
  const connection = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: 30,
    connectTimeout: 30,
    retryStrategy: null,
    lazyConnect: true,
  });
  connection.on('error', () => undefined);
  return { connection, queue: new Queue('notifications-otp', { connection }) };
}

export function createOtpSender(url: string) {
  let current: ReturnType<typeof connect> | undefined = connect(url);
  let closing: Promise<void> | undefined;
  let stopped = false;
  const abort = async (resource: ReturnType<typeof connect>) => {
    if (current === resource) current = undefined;
    resource.connection.disconnect();
    const draining = resource.queue.close();
    closing = draining;
    try {
      await draining;
    } finally {
      if (closing === draining) closing = undefined;
    }
  };
  const sender: OtpSender = {
    enqueue: (ids, deadline) => enqueue(current, abort, { ids, deadline }),
  };
  return {
    sender,
    ready: async () => {
      await closing;
      if (stopped) throw new Error('OTP_ENQUEUE_UNAVAILABLE');
      if (current?.connection.status === 'end') await abort(current);
      if (stopped) throw new Error('OTP_ENQUEUE_UNAVAILABLE');
      current ??= connect(url);
      await current.queue.waitUntilReady();
      if (current.connection.status !== 'ready') throw new Error('OTP_ENQUEUE_UNAVAILABLE');
      await current.connection.ping();
    },
    workerFingerprint: async (deadline?: Date) => {
      if (
        current === undefined ||
        current.connection.status !== 'ready' ||
        (deadline !== undefined && Date.now() + 40 >= deadline.getTime())
      )
        return null;
      return current.connection.get('staff-otp:worker-capability');
    },
    close: async () => {
      stopped = true;
      await closing;
      if (current !== undefined) await abort(current);
    },
  };
}

async function enqueue(
  resource: ReturnType<typeof connect> | undefined,
  abort: (resource: ReturnType<typeof connect>) => Promise<void>,
  request: { ids: { challengeId: string; attemptId: string }; deadline: Date },
) {
  const {
    ids: { challengeId, attemptId },
    deadline,
  } = request;
  if (
    resource === undefined ||
    Date.now() + 30 >= deadline.getTime() ||
    resource.connection.status !== 'ready'
  )
    throw new Error('OTP_ENQUEUE_UNAVAILABLE');
  try {
    await resource.queue.add(
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
    // إنهاء العملية غير المؤكدة أولاً؛ الاتصال الجديد لطلب لاحق فقط، بلا إعادة للوظيفة.
    await abort(resource);
    throw new Error('OTP_ENQUEUE_UNKNOWN');
  }
  if (Date.now() >= deadline.getTime()) throw new Error('OTP_ENQUEUE_UNKNOWN');
}
