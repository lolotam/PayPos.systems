import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { optionalStorage } from '@pospay/storage';
import { VerifyUpload } from './use-cases/verify-upload/verify-upload.ts';
import { verificationRepository } from './persistence/verification.repository.ts';
import { verificationStorage } from './persistence/verification-storage.adapter.ts';
import { startVerificationProcessor } from './jobs/verification.processor.ts';

import { CleanupFiles } from './use-cases/cleanup-files/cleanup-files.ts';
import { retentionRepository } from './persistence/retention.repository.ts';
import { startRetentionProcessors } from './jobs/retention.processor.ts';

export function startFilesWorker(
  db: TenantWrappers,
  ids: IdGenerator,
  redisUrl: string,
  env: Readonly<Record<string, string | undefined>>,
) {
  const capability = optionalStorage(env);
  if (capability === null) return null;
  const useCase = new VerifyUpload(
    verificationRepository(db),
    verificationStorage(capability.storage, capability.policy),
    ids,
    { now: () => new Date() },
  );
  const processor = startVerificationProcessor(useCase, redisUrl);
  const cleanup = new CleanupFiles(retentionRepository(db, ids), capability.storage, ids, {
    now: () => new Date(),
  });
  const retention = startRetentionProcessors(cleanup, redisUrl);
  return {
    deliver: retention.deliver,
    close: async () => {
      await Promise.all([processor.close(), retention.close()]);
      capability.storage.close();
    },
  };
}
