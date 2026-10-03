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
    if (file === null) return;
    try {
      const verified = await this.storage.verify(companyId, file, this.ids.newId());
      if (await this.repository.complete(companyId, fileId, leaseId, verified)) {
        await this.storage.removeStaging(file.stagingKey).catch(() => undefined);
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
