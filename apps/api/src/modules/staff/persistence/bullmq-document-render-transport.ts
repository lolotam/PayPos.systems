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

export function createDocumentRenderTransport(
  redis: Redis,
  prefix = 'bull',
): DocumentRenderTransport & { close(): Promise<void>; onModuleDestroy(): Promise<void> } {
  const connection = redis.duplicate({
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    commandTimeout: 5000,
    keyPrefix: '',
  });
  connection.on('error', () => undefined);
  const queue = new Queue(DOCUMENTS_RENDER_QUEUE, { connection, prefix });
  queue.on('error', () => undefined);
  const close = async () => {
    await queue.close();
    connection.disconnect();
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
      await queue.add('render', payload, documentRenderJobOptions(job.renderId));
    },
    markFailed: async (companyId, renderId) => {
      const key = documentStatusKey(companyId, renderId);
      await redis
        .multi()
        .hset(key, 'state', 'FAILED', 'error_code', 'DOCUMENT_RENDER_FAILED')
        .expire(key, DOCUMENT_STATUS_TTL_SECONDS)
        .exec();
    },
    close,
    onModuleDestroy: close,
  };
}
