import {
  EmployeeCreationError,
  validateEmployeeCreation,
  type EmployeeRecord,
} from '@pospay/domain';
import type { IdGenerator } from '@pospay/db';
import { ImportCommitError } from '../../domain/employee-import.ts';
import type { ImportCommitTransactions } from '../../ports/employee-import.port.ts';
import type { Clock } from '../../ports/clock.port.ts';

// طلب API هو نقطة التفويض؛ الوظيفة تنفذ الطلب المقبول وتعيد التحقق من المعاينة والفروع داخل المعاملة.
export class CommitEmployeeImport {
  constructor(
    private readonly transactions: ImportCommitTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  fail(companyId: string, previewId: string): Promise<void> {
    return this.transactions.fail(companyId, previewId, 'IMPORT_COMMIT_FAILED');
  }

  async execute(companyId: string, previewId: string): Promise<void> {
    try {
      await this.transactions.run(companyId, previewId, async (scope) => {
        const preview = scope.preview;
        if (preview === null || preview.status !== 'commit_requested') return;
        if (preview.errors.length > 0) throw new ImportCommitError('IMPORT_PREVIEW_HAS_ERRORS');
        if (new Date(preview.expires_at).getTime() <= this.clock.now().getTime())
          throw new ImportCommitError('IMPORT_PREVIEW_EXPIRED');
        const branches = new Set(await scope.branches(preview.business_id));
        const at = this.clock.now().toISOString();
        const records = preview.rows.map((row): EmployeeRecord => {
          const record = {
            id: this.ids.newId(),
            business_id: preview.business_id,
            primary_branch_id: row.primary_branch_id,
            name_en: row.name_en,
            name_ar: row.name_ar,
            role_code: row.role_code,
            hire_date: row.hire_date,
            contract_end: row.contract_end,
            user_id: null,
            created_at: at,
          };
          validateEmployeeCreation(record, {
            businessExists: true,
            branchBusinessId: branches.has(row.primary_branch_id) ? preview.business_id : null,
          });
          return record;
        });
        await scope.insert(records);
        await scope.complete(preview, records, at);
      });
    } catch (error) {
      if (error instanceof ImportCommitError || error instanceof EmployeeCreationError)
        await this.transactions.fail(companyId, previewId, error.code);
      else throw error;
    }
  }
}
