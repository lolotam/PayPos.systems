import {
  retentionCutoff,
  retentionLeaseUntil,
  type RetentionKind,
} from '../../domain/retention.ts';
import type { RetentionRepository, RetentionStorage } from '../../ports/retention.port.ts';
import type { Clock, IdGenerator } from '../../ports/verification.port.ts';

// قرار المالك: نحذف الأجسام المؤهلة فقط، ثم نثبت tombstone والتدقيق داخل معاملة واحدة.
export class CleanupFiles {
  constructor(
    private readonly repository: RetentionRepository,
    private readonly storage: RetentionStorage,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}
  async execute(companyId: string, kind: RetentionKind): Promise<number> {
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
      await this.storage.remove(file.stagingKey);
      if (await this.repository.complete(companyId, file.id, kind, leaseId, this.clock.now()))
        deleted++;
    }
    return deleted;
  }
}
