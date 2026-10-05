import type { EmployeeImportCommitAccepted } from '@pospay/contracts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { EmployeeImportError } from '../../domain/employee-import.ts';
import type { EmployeeImportTransactions } from '../../ports/employee-import.port.ts';

export interface CommitEmployeeImportCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly previewId: string;
  readonly key: string;
  readonly fingerprint: string;
}

// يقبل طلباً واحداً فقط؛ الإنشاء الذري الثقيل يخص وظيفة staff في worker (ADR-0034).
export class CommitEmployeeImportUseCase {
  constructor(
    private readonly transactions: EmployeeImportTransactions,
    _ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CommitEmployeeImportCommand): Promise<EmployeeImportCommitAccepted> {
    return this.transactions.runCommit(command, async (scope) => {
      const preview = await scope.load(command.previewId);
      if (
        preview === null ||
        preview.business_id !== command.businessId ||
        preview.created_by !== command.userId
      )
        throw new EmployeeImportError('IMPORT_PREVIEW_NOT_FOUND');
      if (preview.status !== 'ready') return { preview_id: preview.id };
      if (new Date(preview.expires_at).getTime() <= this.clock.now().getTime())
        throw new EmployeeImportError('IMPORT_PREVIEW_EXPIRED');
      if (preview.errors.length > 0) throw new EmployeeImportError('IMPORT_PREVIEW_HAS_ERRORS');
      await scope.request(preview.id, this.clock.now().toISOString());
      return { preview_id: preview.id };
    });
  }
}
