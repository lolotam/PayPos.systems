import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import type { notificationRedisOptions } from '@pospay/notifications';

// Own the socket explicitly: BullMQ's client/disconnect accessor itself waits for readiness.
export function notificationQueue(
  name: string,
  options: ReturnType<typeof notificationRedisOptions>,
  onError: () => void,
) {
  const connection = new Redis({ ...options, enableOfflineQueue: false, maxRetriesPerRequest: 1 });
  connection.on('error', onError);
  const queue = new Queue(name, { connection });
  return {
    queue,
    close: async (force = false) => {
      if (force) connection.disconnect();
      try {
        await queue.close();
      } finally {
        connection.disconnect();
      }
    },
  };
}
