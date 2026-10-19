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
import { RetireBusinessLogo } from './use-cases/retire-business-logo/retire-business-logo.ts';
import { logoRetirementStore } from './persistence/logo-retirement.ts';
import { logoReference } from './persistence/logo-reference.ts';
import { retireBusinessLogoConsumer } from './events/handlers/on-business-logo-changed.ts';
import type { Clock } from './ports/verification.port.ts';

type StorageCapability = Exclude<ReturnType<typeof optionalStorage>, null>;

export function startFilesWorker(
  db: TenantWrappers,
  ids: IdGenerator,
  redisUrl: string,
  env: Readonly<Record<string, string | undefined>>,
) {
  const capability = optionalStorage(env);
  const clock = { now: () => new Date() };
  const stored = capability === null ? null : startStored(db, ids, redisUrl, capability, clock);
  const cleanup = new CleanupFiles(
    retentionRepository(db, ids),
    capability?.storage ?? null,
    ids,
    clock,
    stored?.artifacts,
  );
  const retention = startRetentionProcessors(cleanup, redisUrl);
  return {
    consumer: retireBusinessLogoConsumer(
      new RetireBusinessLogo(logoRetirementStore(), logoReference(), clock),
    ),
    deliver: retention.deliver,
    close: async () => {
      await stored?.processor.close();
      await retention.close();
      capability?.storage.close();
    },
  };
}

function startStored(
  db: TenantWrappers,
  ids: IdGenerator,
  redisUrl: string,
  capability: StorageCapability,
  clock: Clock,
) {
  const artifacts = new CleanupArtifacts(
    artifactRepository(db, ids),
    capability.storage,
    ids,
    clock,
  );
  const processor = startVerificationProcessor(
    new VerifyUpload(
      verificationRepository(db),
      verificationStorage(capability.storage, capability.policy),
      ids,
      clock,
      artifacts,
    ),
    redisUrl,
  );
  return { artifacts, processor };
}
