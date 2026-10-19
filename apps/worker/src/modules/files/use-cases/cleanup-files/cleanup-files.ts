import type { ArtifactCleanup } from '../../ports/artifact-cleanup.port.ts';
import {
  retentionCutoff,
  retentionLeaseUntil,
  type RetentionKind,
} from '../../domain/retention.ts';
import type {
  RetentionFile,
  RetentionRepository,
  RetentionStorage,
} from '../../ports/retention.port.ts';
import type { Clock, IdGenerator } from '../../ports/verification.port.ts';

// قرار المالك: نحذف الأجسام المؤهلة فقط، ثم نثبت tombstone والتدقيق داخل معاملة واحدة.
export class CleanupFiles {
  constructor(
    private readonly repository: RetentionRepository,
    private readonly storage: RetentionStorage | null,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly artifacts?: ArtifactCleanup,
  ) {}
  async execute(companyId: string, kind: RetentionKind): Promise<number> {
    try {
      const storage = this.storage;
      if (storage === null) return 0;
      return await this.purge(companyId, kind, storage);
    } finally {
      await this.artifacts?.execute(companyId);
    }
  }
  private async purge(
    companyId: string,
    kind: RetentionKind,
    storage: RetentionStorage,
  ): Promise<number> {
    const at = this.clock.now(),
      leaseId = this.ids.newId();
    const files = await this.repository.claim(
      companyId,
      kind,
      leaseId,
      at,
      retentionCutoff(kind, at),
      retentionLeaseUntil(at),
    );
    let deleted = 0;
    for (const file of files) {
      await removeObjects(storage, kind, file);
      if (await this.repository.complete(companyId, file.id, kind, leaseId, this.clock.now()))
        deleted++;
    }
    return deleted;
  }
}

async function removeObjects(
  storage: RetentionStorage,
  kind: RetentionKind,
  file: RetentionFile,
): Promise<void> {
  if (kind === 'retired' && file.storageKey !== null) await storage.remove(file.storageKey);
  await storage.remove(file.stagingKey);
}
