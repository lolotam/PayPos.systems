import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { optionalStorage } from '@pospay/storage';
import { CleanupArtifacts } from './use-cases/cleanup-artifacts/cleanup-artifacts.ts';
import { artifactRepository } from './persistence/artifact.repository.ts';
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
  const clock = { now: () => new Date() };
  const artifacts = new CleanupArtifacts(
    artifactRepository(db, ids),
    capability.storage,
    ids,
    clock,
  );
  const useCase = new VerifyUpload(
    verificationRepository(db),
    verificationStorage(capability.storage, capability.policy),
    ids,
    clock,
    artifacts,
  );
  const processor = startVerificationProcessor(useCase, redisUrl);
  const cleanup = new CleanupFiles(
    retentionRepository(db, ids),
    capability.storage,
    ids,
    clock,
    artifacts,
  );
  const retention = startRetentionProcessors(cleanup, redisUrl);
  return {
    deliver: retention.deliver,
    close: async () => {
      await Promise.all([processor.close(), retention.close()]);
      capability.storage.close();
    },
  };
}
