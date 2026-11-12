import { Queue, Worker, DelayedError, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { z } from 'zod';
import {
  LEAVE_HISTORY_REPORT_FAILURE_CODES,
  leaveHistoryReportJob,
  leaveHistoryReportRequested,
} from '@pospay/contracts';
import type { ClaimedEvent, DeliveryOutcome } from '@pospay/db';
import {
  LeaveHistoryReportRetryError,
  type BuildLeaveHistoryReport,
} from '../use-cases/build-leave-history-report/build-leave-history-report.ts';

export const LEAVE_HISTORY_REPORT_QUEUE = 'leave-history-report';
const FINALIZING_FAILURE = 'finalizing-leave-history-failure';
const failureProgress = z.strictObject({
  stage: z.literal(FINALIZING_FAILURE),
  code: z.enum(LEAVE_HISTORY_REPORT_FAILURE_CODES),
});
type Failure = z.infer<typeof failureProgress>;

function reportHandler(useCase: BuildLeaveHistoryReport) {
  return async (job: Job, token?: string) => {
    const parsed = leaveHistoryReportJob.safeParse(job.data);
    if (!parsed.success) throw new Error('LEAVE_HISTORY_REPORT_JOB_INVALID');
    const { companyId, reportId } = parsed.data;
    const progress = failureProgress.safeParse(job.progress);
    if (progress.success)
      return persistFailure(useCase, job, token, { companyId, reportId, ...progress.data });
    try {
      await useCase.execute(companyId, reportId);
    } catch (error) {
      const code = error instanceof LeaveHistoryReportRetryError ? error.failureCode : undefined;
      if (code === undefined && job.attemptsMade + 1 < (job.opts.attempts ?? 1)) throw error;
      const failure = failureProgress.parse({
        stage: FINALIZING_FAILURE,
        code: code ?? 'LEAVE_HISTORY_REPORT_FAILED',
      });
      await job.updateProgress(failure);
      return persistFailure(useCase, job, token, { companyId, reportId, ...failure });
    }
  };
}

async function persistFailure(
  useCase: BuildLeaveHistoryReport,
  job: Job,
  token: string | undefined,
  failure: Failure & { companyId: string; reportId: string },
) {
  try {
    await useCase.fail(failure.companyId, failure.reportId, failure.code);
  } catch {
    await job.moveToDelayed(Date.now() + 2000, token);
    throw new DelayedError();
  }
}

export function startLeaveHistoryReportProcessor(
  useCase: BuildLeaveHistoryReport,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const producer = connection.duplicate({ maxRetriesPerRequest: 1, commandTimeout: 5000 });
  producer.on('error', () => undefined);
  const queue = new Queue(LEAVE_HISTORY_REPORT_QUEUE, { connection: producer, prefix });
  queue.on('error', () => undefined);
  const worker = new Worker(LEAVE_HISTORY_REPORT_QUEUE, reportHandler(useCase), {
    connection,
    concurrency: 1,
    prefix,
  });
  worker.on('error', () => undefined);
  return {
    deliver: (event: ClaimedEvent) => deliverReport(queue, useCase, event),
    ready: () => worker.waitUntilReady().then(() => undefined),
    close: async () => {
      await worker.close();
      await queue.close();
      producer.disconnect();
      connection.disconnect();
    },
  };
}

async function deliverReport(
  queue: Queue,
  useCase: BuildLeaveHistoryReport,
  event: ClaimedEvent,
): Promise<DeliveryOutcome> {
  const data = leaveHistoryReportJob.safeParse({
    companyId: event.companyId,
    reportId: event.aggregateId,
  });
  const payload = leaveHistoryReportRequested.safeParse(event.payload);
  if (
    !data.success ||
    !payload.success ||
    payload.data.report_id.toLowerCase() !== data.data.reportId.toLowerCase()
  ) {
    if (data.success) {
      try {
        await useCase.fail(data.data.companyId, data.data.reportId);
      } catch {
        return {
          delivered: false,
          error: 'LEAVE_HISTORY_REPORT_FAILURE_PERSIST_RETRY',
          retryInMs: 2000,
        };
      }
    }
    return { delivered: false, error: 'LEAVE_HISTORY_REPORT_EVENT_INVALID', retryInMs: null };
  }
  try {
    await queue.add('build', data.data, {
      jobId: event.id,
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 100,
    });
    return { delivered: true };
  } catch {
    return { delivered: false, error: 'LEAVE_HISTORY_REPORT_QUEUE_RETRY', retryInMs: 2000 };
  }
}
