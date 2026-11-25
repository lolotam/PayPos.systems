import type { ServiceImportCommitAccepted } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import { ServiceImportError } from '../../domain/errors.ts';
import { requireServiceImportRequestExpiry } from '../../domain/service-import.ts';
import type { ServiceImportTransactions } from '../../ports/service-import.port.ts';

export interface CommitServiceImportCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly previewId: string;
  readonly key: string;
  readonly fingerprint: string;
}

// يقبل طلباً واحداً فقط؛ الإنشاء الذري الثقيل يخص وظيفة الكتالوج في worker (FR-009).
export class CommitServiceImportUseCase {
  constructor(
    private readonly transactions: Pick<ServiceImportTransactions, 'runCommit'>,
    private readonly clock: Clock,
  ) {}

  execute(command: CommitServiceImportCommand): Promise<ServiceImportCommitAccepted> {
    return this.transactions.runCommit(command, async (scope) => {
      const preview = await scope.load(command.previewId);
      // المقارنة بحروف صغيرة مثل طبقة الداتابيز: المعرفان نصوص، فلا يعد اختلاف
      // حالة الأحرف نشاطاً أو مستخدماً آخر (FR-011).
      if (
        preview === null ||
        preview.business_id.toLowerCase() !== command.businessId.toLowerCase() ||
        preview.created_by.toLowerCase() !== command.userId.toLowerCase()
      )
        throw new ServiceImportError('IMPORT_PREVIEW_NOT_FOUND');
      // الطلب المقبول سابقاً لا يطلب مرتين: الرد نفسه بلا حدث جديد.
      if (preview.status !== 'ready') return { preview_id: preview.id };
      const requestedAt = this.clock.now();
      requireServiceImportRequestExpiry(preview.expires_at, requestedAt);
      if (preview.error_count > 0 || preview.errors.length > 0)
        throw new ServiceImportError('IMPORT_PREVIEW_HAS_ERRORS');
      await scope.request(preview.id, requestedAt.toISOString());
      return { preview_id: preview.id };
    });
  }
}
