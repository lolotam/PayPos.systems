import { customerImportCommitJob, customerImportCommitRequested } from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import { DelayedError, Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';

import type {
  CommitCustomerImport,
  RecoverCustomerImports,
} from '../use-cases/commit-customer-import/commit-customer-import.ts';

export const CUSTOMER_IMPORT_COMMIT_QUEUE = 'customer-import-commit';
export const CUSTOMER_IMPORT_RECOVERY_QUEUE = 'customer-import-recovery';
const CUSTOMER_IMPORT_ATTEMPTS = 4;
const recoveryJob = z.strictObject({ companyId: z.uuid() });

async function persistFailure(
  commit: CommitCustomerImport,
  job: Job,
  token: string | undefined,
  companyId: string,
  previewId: string,
): Promise<void> {
  try {
    await commit.fail(companyId, previewId);
  } catch {
    await job.moveToDelayed(Date.now() + 2000, token);
    throw new DelayedError();
  }
}

function commitHandler(commit: CommitCustomerImport) {
  return async (job: Job, token?: string): Promise<void> => {
    const parsed = customerImportCommitJob.safeParse(job.data);
    if (!parsed.success) throw new Error('CUSTOMER_IMPORT_JOB_INVALID');
    const { companyId, previewId } = parsed.data;
    const finalizing =
      job.progress !== null && typeof job.progress === 'object' && 'stage' in job.progress;
    if (finalizing || job.attemptsMade >= (job.opts.attempts ?? 1))
      return persistFailure(commit, job, token, companyId, previewId);
    try {
      await commit.execute(companyId, previewId);
    } catch (error) {
      if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
        await job.updateProgress({ stage: 'finalizing-customer-import-commit-failure' }).catch(() => undefined);
        return persistFailure(commit, job, token, companyId, previewId);
      }
      throw error;
    }
  };
}

async function deliverCommit(
  commitQueue: Queue,
  recoveryQueue: Queue,
  event: ClaimedEvent,
): Promise<DeliveryOutcome> {
  const data = customerImportCommitJob.safeParse({
    companyId: event.companyId,
    previewId: event.aggregateId,
  });
  const payload = customerImportCommitRequested.safeParse(event.payload);
  if (
    event.aggregateType !== 'import_preview' ||
    !data.success ||
    !payload.success ||
    payload.data.preview_id.toLowerCase() !== data.data.previewId.toLowerCase()
  )
    return { delivered: false, error: 'CUSTOMER_IMPORT_COMMIT_EVENT_INVALID', retryInMs: null };
  try {
    // تسجيل جدولة الاسترداد قبل إضافة مهمة الالتزام يضمن إفشال الطلبات العالقة حتى عند فشل الطابور (ADR-0022).
    await recoveryQueue.upsertJobScheduler(
      `${CUSTOMER_IMPORT_RECOVERY_QUEUE}-${data.data.companyId}`,
      { every: 60 * 1000 },
      {
        name: 'recover',
        data: recoveryJob.parse({ companyId: data.data.companyId }),
        opts: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: true, removeOnFail: 100 },
      },
    );
    await commitQueue.add('commit', data.data, {
      jobId: event.id,
      attempts: CUSTOMER_IMPORT_ATTEMPTS,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'CUSTOMER_IMPORT_COMMIT_QUEUE_RETRY', retryInMs: 2000 };
  }
}

// ADR-0018 وADR-0022: تسجيل مسح الاسترداد في Redis قبل إقرار حدث الالتزام؛ jobId ثابت يزيل أثر الإعادة.
export function startCustomerImportProcessor(
  commit: CommitCustomerImport,
  recovery: RecoverCustomerImports,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const commitQueue = new Queue(CUSTOMER_IMPORT_COMMIT_QUEUE, { connection: producer, prefix });
  const recoveryQueue = new Queue(CUSTOMER_IMPORT_RECOVERY_QUEUE, { connection: producer, prefix });
  commitQueue.on('error', () => undefined);
  recoveryQueue.on('error', () => undefined);
  const commitWorker = new Worker(CUSTOMER_IMPORT_COMMIT_QUEUE, commitHandler(commit), {
    connection,
    concurrency: 1,
    prefix,
  });
  const recoveryWorker = new Worker(
    CUSTOMER_IMPORT_RECOVERY_QUEUE,
    async (job) => {
      const { companyId } = recoveryJob.parse(job.data);
      await recovery.execute(companyId).catch(() => {
        throw new Error('CUSTOMER_IMPORT_RECOVERY_RETRY');
      });
    },
    { connection, concurrency: 1, prefix },
  );
  commitWorker.on('error', () => undefined);
  recoveryWorker.on('error', () => undefined);
  commitWorker.on('failed', (job) => {
    const parsed = job ? customerImportCommitJob.safeParse(job.data) : null;
    if (!parsed?.success || typeof job?.finishedOn !== 'number') return;
    void commit.fail(parsed.data.companyId, parsed.data.previewId).catch(() => undefined);
  });
  return {
    deliver: (event: ClaimedEvent) => deliverCommit(commitQueue, recoveryQueue, event),
    ready: async () => {
      await Promise.all([commitWorker.waitUntilReady(), recoveryWorker.waitUntilReady()]);
    },
    close: async (force = false) => {
      await commitWorker.close(force);
      await recoveryWorker.close(force);
      await Promise.all([commitQueue.close(), recoveryQueue.close()]);
      producer.disconnect();
      connection.disconnect();
    },
  };
}
