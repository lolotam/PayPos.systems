import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { fileVerificationJob } from '@pospay/contracts';
import type { VerifyUpload } from '../use-cases/verify-upload/verify-upload.ts';

export function startVerificationProcessor(
  useCase: VerifyUpload,
  redisUrl: string,
  prefix = 'bull',
) {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null, enableOfflineQueue: false });
  connection.on('error', () => undefined);
  const worker = new Worker(
    'files-verify',
    async (job) => {
      const parsed = fileVerificationJob.safeParse(job.data);
      if (!parsed.success) throw new Error('FILE_JOB_INVALID');
      await useCase.execute(parsed.data.companyId, parsed.data.fileId);
    },
    { connection, concurrency: 2, prefix },
  );
  worker.on('error', () => undefined);
  return {
    close: async () => {
      await worker.close();
      connection.disconnect();
    },
  };
}
