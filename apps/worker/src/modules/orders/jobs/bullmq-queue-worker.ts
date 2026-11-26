import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';

/** خيارات عامل الطابور: اللي BullMQ بياخده من غير تكرار في كل معالج. */
export interface BullQueueWorkerOptions {
  readonly name: string;
  readonly redisUrl: string;
  readonly prefix?: string;
  readonly handler: (job: Job) => Promise<unknown>;
  readonly concurrency?: number;
  readonly lockDurationMs?: number;
  readonly maxStalledCount?: number;
  readonly stalledIntervalMs?: number;
}

/** طابور وعامل جاهزان: الطابور للنشر والعامل للتنفيذ، مع الجاهزية والإغلاق. */
export interface BullQueueWorker {
  readonly queue: Queue;
  readonly worker: Worker;
  ready(): Promise<void>;
  close(force?: boolean): Promise<void>;
}

/**
 * يفتح اتصال Redis ومنتج الطابور والعامل مرة واحدة ويبتلع أخطاءهم؛
 * كل معالج كان بيعمل نفس الكلام فالتكرار كان بيخفي اختلافات مهمة.
 *
 * @param options اسم الطابور ورابط Redis والمعالج وإعدادات العامل
 * @returns الطابور والعامل مع الجاهزية والإغلاق
 */
export function createBullQueueWorker(options: BullQueueWorkerOptions): BullQueueWorker {
  const prefix = options.prefix ?? 'bull';
  const connection = new Redis(options.redisUrl, {
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
  });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(options.name, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(options.name, options.handler, {
    connection,
    concurrency: options.concurrency ?? 1,
    prefix,
    ...(options.lockDurationMs === undefined ? {} : { lockDuration: options.lockDurationMs }),
    ...(options.maxStalledCount === undefined ? {} : { maxStalledCount: options.maxStalledCount }),
    ...(options.stalledIntervalMs === undefined
      ? {}
      : { stalledInterval: options.stalledIntervalMs }),
  });
  worker.on('error', () => undefined);
  return {
    queue,
    worker,
    ready: () => worker.waitUntilReady().then(() => undefined),
    close: async (force = false) => {
      await worker.close(force);
      await queue.close();
      producer.disconnect();
      connection.disconnect();
    },
  };
}
