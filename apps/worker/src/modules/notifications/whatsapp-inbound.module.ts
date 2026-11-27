import {
  WHATSAPP_INBOUND_QUEUE,
  WHATSAPP_INBOX_ID,
  whatsappInboundJob,
  notificationRedisOptions,
} from '@pospay/notifications';
import type { PlatformWhatsappDatabase } from '@pospay/db';
import type { Logger } from '@pospay/observability';
import { Worker, type Queue } from 'bullmq';

import { createWhatsappInboxRepository } from './persistence/drizzle-whatsapp-inbox.repository.ts';
import { ProcessWhatsappInbox } from './use-cases/process-whatsapp-inbox/process-whatsapp-inbox.ts';
import { RecoverWhatsappInbox } from './use-cases/recover-whatsapp-inbox/recover-whatsapp-inbox.ts';
import { ClearWhatsappPayloads } from './use-cases/clear-whatsapp-payloads/clear-whatsapp-payloads.ts';
import { whatsappInboundProcessor } from './jobs/whatsapp-inbound.processor.ts';
import { whatsappMaintenanceProcessor } from './jobs/whatsapp-maintenance.processor.ts';
import { notificationQueue } from './jobs/notification-queue.ts';

export function startWhatsappInbound(
  database: PlatformWhatsappDatabase,
  redisUrl: string,
  logger: Logger,
) {
  const connection = notificationRedisOptions(redisUrl);
  const error = () => logger.warn({}, 'whatsapp inbox queue error');
  const resource = notificationQueue(WHATSAPP_INBOUND_QUEUE, connection, error);
  const maintenanceResource = notificationQueue(
    'notifications-inbound-maintenance',
    connection,
    error,
  );
  const queue = resource.queue,
    maintenanceQueue = maintenanceResource.queue;
  const { worker, maintenanceWorker } = bindWhatsappProcessors(database, queue, connection);
  logWhatsappQueues([queue, maintenanceQueue], [worker, maintenanceWorker], logger);
  let scheduled = false;
  let closed = false;
  return {
    ready: async () => {
      if (closed) throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
      await database.ping();
      await Promise.all([
        queue.waitUntilReady(),
        maintenanceQueue.waitUntilReady(),
        worker.waitUntilReady(),
        maintenanceWorker.waitUntilReady(),
      ]);
      if (closed) throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
      if (!scheduled) {
        await scheduleWhatsappMaintenance(maintenanceQueue, () => closed);
        scheduled = true;
      }
    },
    stop: async () => {
      await Promise.all([worker.close(), maintenanceWorker.close()]);
    },
    close: async (force = false) => {
      closed = true;
      await Promise.allSettled([
        worker.close(force),
        maintenanceWorker.close(force),
        resource.close(force),
        maintenanceResource.close(force),
      ]);
    },
  };
}

async function scheduleWhatsappMaintenance(queue: Queue, closed: () => boolean) {
  await queue.upsertJobScheduler(
    'recover-inbox',
    { every: 30_000 },
    {
      name: 'recover-inbox',
      data: {},
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    },
  );
  if (closed()) throw new Error('WHATSAPP_CAPABILITY_UNAVAILABLE');
  await queue.upsertJobScheduler(
    'clear-payloads',
    { every: 60 * 60 * 1000 },
    {
      name: 'clear-payloads',
      data: {},
      opts: { attempts: 1, removeOnComplete: true, removeOnFail: true },
    },
  );
}

function bindWhatsappProcessors(
  database: PlatformWhatsappDatabase,
  queue: Queue,
  connection: ReturnType<typeof notificationRedisOptions>,
) {
  const inbox = createWhatsappInboxRepository(database);
  const clock = { now: () => new Date() };
  const recover = new RecoverWhatsappInbox(
    inbox,
    {
      enqueue: async (id) => {
        const job = whatsappInboundJob(id);
        await queue.add(job.name, job.data, job.options);
      },
    },
    clock,
  );
  const worker = new Worker(
    WHATSAPP_INBOUND_QUEUE,
    whatsappInboundProcessor(new ProcessWhatsappInbox(inbox, clock)),
    { connection, concurrency: 4 },
  );
  const maintenanceWorker = new Worker(
    'notifications-inbound-maintenance',
    whatsappMaintenanceProcessor(recover, new ClearWhatsappPayloads(inbox, clock)),
    { connection, concurrency: 1 },
  );
  return { worker, maintenanceWorker };
}

function logWhatsappQueues(queues: Queue[], workers: Worker[], logger: Logger): void {
  const error = () => logger.warn({}, 'whatsapp inbox queue error');
  for (const source of queues) source.on('error', error);
  for (const source of workers) source.on('error', error);
  for (const source of workers)
    source.on('failed', (job, error) =>
      logger.warn(
        {
          event: {
            id: job?.id !== undefined && WHATSAPP_INBOX_ID.test(job.id) ? job.id : undefined,
          },
          err: error,
        },
        'whatsapp inbox job failed',
      ),
    );
}
