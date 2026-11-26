import { type Job } from 'bullmq';
import { z } from 'zod';
import type { RecoverPackageImports } from '../use-cases/recover-package-imports/recover-package-imports.ts';
import { createBullQueueWorker } from './bullmq-queue-worker.ts';

export const PACKAGE_IMPORT_RECOVERY_QUEUE = 'package-import-recovery';
const recoveryJob = z.strictObject({ companyId: z.uuid() });
// الخطأ الخام من قاعدة البيانات قد يحمل نص الاستعلام ومعاملاته فلا يكتبه BullMQ في failedReason؛ المحاولات تعيد المسح برسالة ثابتة.
const RETRY_MESSAGE = 'PACKAGE_IMPORT_RECOVERY_RETRY';

export function startPackageImportRecoveryProcessor(
  useCase: RecoverPackageImports,
  redisUrl: string,
  prefix = 'bull',
) {
  const bull = createBullQueueWorker({
    name: PACKAGE_IMPORT_RECOVERY_QUEUE,
    redisUrl,
    prefix,
    handler: async (job: Job) => {
      const { companyId } = recoveryJob.parse(job.data);
      await useCase.execute(companyId).catch(() => {
        throw new Error(RETRY_MESSAGE);
      });
    },
  });
  return {
    register: async (companyId: string): Promise<void> => {
      await bull.queue.upsertJobScheduler(
        `${PACKAGE_IMPORT_RECOVERY_QUEUE}-${companyId}`,
        { every: 60 * 1000 },
        {
          name: 'recover',
          data: recoveryJob.parse({ companyId }),
          opts: {
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
            removeOnComplete: true,
            removeOnFail: 100,
          },
        },
      );
    },
    ready: bull.ready,
    close: bull.close,
  };
}
