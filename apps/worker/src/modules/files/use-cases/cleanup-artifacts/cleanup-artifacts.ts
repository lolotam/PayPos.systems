import { nextArtifactCleanup } from '../../domain/artifacts.ts';
import { retentionLeaseUntil } from '../../domain/retention.ts';
import type { ArtifactRepository, ArtifactStorage } from '../../ports/artifact-cleanup.port.ts';
import type { Clock, IdGenerator } from '../../ports/verification.port.ts';

// الحذف خارج DB؛ المطالبة المسجلة تنجو من crash وتمنع النشر المتأخر.
export class CleanupArtifacts {
  constructor(
    private readonly repository: ArtifactRepository,
    private readonly storage: ArtifactStorage,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}
  async execute(companyId: string): Promise<number> {
    const at = this.clock.now(),
      leaseId = this.ids.newId();
    const artifacts = await this.repository.claim(companyId, leaseId, at, retentionLeaseUntil(at));
    let count = 0;
    for (const artifact of artifacts) {
      try {
        await this.storage.remove(artifact.key);
        const deletedAt = this.clock.now();
        if (
          await this.repository.complete(
            companyId,
            artifact.id,
            leaseId,
            deletedAt,
            nextArtifactCleanup(artifact.kind, artifact.expiryAt, deletedAt),
          )
        )
          count++;
      } catch {
        await this.repository.release(companyId, artifact.id, leaseId);
        throw new Error('FILE_ARTIFACT_CLEANUP_RETRY');
      }
    }
    return count;
  }
}
