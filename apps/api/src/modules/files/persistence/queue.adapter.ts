import { Queue } from 'bullmq';
import type { FileQueue } from '../ports/files.port.ts';
import type { Redis } from 'ioredis';

export function createFileQueue(redis: Redis, prefix = 'bull') {
  const connection = redis.duplicate({
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 5000,
    keyPrefix: '',
  });
  connection.on('error', () => undefined);
  const queue = new Queue('files-verify', { connection, prefix });
  queue.on('error', () => undefined);
  const port: FileQueue = {
    enqueue: async (companyId, fileId) => {
      try {
        await queue.add(
          'verify',
          { companyId, fileId },
          {
            jobId: `${companyId}-${fileId}`,
            attempts: 8,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      } catch {
        throw new Error('STORAGE_UNAVAILABLE');
      }
    },
  };
  return {
    port,
    close: async () => {
      await queue.close();
      connection.disconnect();
    },
  };
}
