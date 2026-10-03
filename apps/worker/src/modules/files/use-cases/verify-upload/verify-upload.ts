import type { ArtifactCleanup } from '../../ports/artifact-cleanup.port.ts';
import { VerificationRejected, verificationDeadline } from '../../domain/verification.ts';
import type {
  Clock,
  IdGenerator,
  VerificationRepository,
  VerificationStorage,
} from '../../ports/verification.port.ts';

// يفحص الوثيقة خارج المعاملة ثم ينشر نسخة مستقلة بمطالبة مشروطة.
export class VerifyUpload {
  constructor(
    private readonly repository: VerificationRepository,
    private readonly storage: VerificationStorage,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly artifacts: ArtifactCleanup,
  ) {}
  async execute(companyId: string, fileId: string): Promise<void> {
    const leaseId = this.ids.newId(),
      at = this.clock.now();
    const file = await this.repository.claim(
      companyId,
      fileId,
      leaseId,
      at,
      verificationDeadline(at),
    );
    if (file === null) {
      await this.artifacts.execute(companyId);
      return;
    }
    try {
      const content = await this.storage.inspect(file);
      const candidateId = this.ids.newId();
      const key = this.storage.candidateKey(companyId, file.businessId, candidateId);
      const reservedAt = this.clock.now();
      if (
        !(await this.repository.reserve(
          companyId,
          fileId,
          leaseId,
          candidateId,
          key,
          reservedAt,
          verificationDeadline(reservedAt),
        ))
      )
        return;
      await this.storage.write(key, content);
      if (
        await this.repository.complete(
          companyId,
          fileId,
          leaseId,
          { key, type: content.type, size: content.size },
          this.clock.now(),
        )
      ) {
        await this.artifacts.execute(companyId);
      }
    } catch (error) {
      if (error instanceof VerificationRejected) {
        await this.repository.reject(companyId, fileId, leaseId, error.code, this.clock.now());
        return;
      }
      await this.repository.release(companyId, fileId, leaseId);
      throw error;
    }
  }
}
