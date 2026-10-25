import {
  DOCUMENT_RENDERER_ALIVE_KEY,
  DOCUMENT_STATUS_TTL_SECONDS,
  DOCUMENTS_RENDER_QUEUE,
  documentRenderJob,
  documentRenderJobOptions,
  documentStatusKey,
} from '@pospay/contracts';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';

import type { DocumentRenderTransport } from '../ports/attendance-statement.port.ts';

// نفس اتصال الطابور يرتب الفحص بعد الإضافة؛ وجود المهمة أو تقدم حالتها يمنع فشل رد متأخر من إتلافها.
const MARK_ENQUEUE_FAILED = `
if redis.call('EXISTS', KEYS[2]) == 1 then return 0 end
local state = redis.call('HGET', KEYS[1], 'state')
if state and state ~= 'QUEUED' then return 0 end
redis.call('HSET', KEYS[1], 'state', 'FAILED', 'error_code', 'DOCUMENT_RENDER_FAILED')
redis.call('EXPIRE', KEYS[1], ARGV[1])
return 1
`;

export function createDocumentRenderTransport(
  redis: Redis,
  prefix = 'bull',
): DocumentRenderTransport & { close(): Promise<void>; onModuleDestroy(): Promise<void> } {
  // الاتصال الإضافي يتفتح عند أول طلب مستند، مش مع تهيئة كل مسارات الموظفين.
  let resources: ReturnType<typeof createQueueResources> | undefined;
  const queueResources = () => (resources ??= createQueueResources(redis, prefix));
  const close = async () => {
    if (resources === undefined) return;
    await resources.queue.close();
    resources.connection.disconnect();
  };
  return {
    rendererAlive: async () => (await redis.exists(DOCUMENT_RENDERER_ALIVE_KEY)) === 1,
    queue: async (job) => {
      const payload = documentRenderJob.parse({
        company_id: job.companyId,
        render_id: job.renderId,
        kind: job.kind,
      });
      const key = documentStatusKey(job.companyId, job.renderId);
      await redis
        .multi()
        .hset(key, 'state', 'QUEUED', 'requested_by', job.requestedBy, 'filename', job.filename)
        .expire(key, DOCUMENT_STATUS_TTL_SECONDS)
        .exec();
      const { queue } = queueResources();
      await waitForQueue(queue);
      await queue.add('render', payload, documentRenderJobOptions(job.renderId));
    },
    markFailed: async (companyId, renderId) => {
      const { connection, queue } = queueResources();
      await waitForQueue(queue);
      const key = `${redis.options.keyPrefix ?? ''}${documentStatusKey(companyId, renderId)}`;
      const result = await connection.eval(
        MARK_ENQUEUE_FAILED,
        2,
        key,
        queue.toKey(renderId),
        String(DOCUMENT_STATUS_TTL_SECONDS),
      );
      return result !== 0;
    },
    close,
    onModuleDestroy: close,
  };
}

function createQueueResources(redis: Redis, prefix: string) {
  const connection = redis.duplicate({
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 5000,
    keyPrefix: '',
  });
  connection.on('error', () => undefined);
  const queue = new Queue(DOCUMENTS_RENDER_QUEUE, { connection, prefix });
  queue.on('error', () => undefined);
  return { connection, queue };
}

// أول استعمال يستنى الاتصال بمهلة محدودة؛ انقطاع Redis ما يعلّقش طلب HTTP بلا نهاية.
async function waitForQueue(queue: Queue): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Document queue connection timed out')), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
