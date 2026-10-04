import type { EmployeeImportCommit } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { EmployeeImportError } from '../../domain/employee-import.ts';
import { validateEmployeeCreation, type EmployeeRecord } from '../../domain/create-employee.ts';
import type { EmployeeImportTransactions } from '../../ports/employee-import.port.ts';

export interface CommitEmployeeImportCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly previewId: string;
  readonly key: string;
  readonly fingerprint: string;
}

// TODO(spec) IM-Q2: الالتزام متزامن عند سقف 500 صف؛ إن قاس التشغيل أكثر من 200 ms ينقل إلى worker مع حالة polling.
// ينفّذ استيراد الموظفين كلهم في معاملة واحدة بعد إعادة التحقق من الفروع تحت القفل.
export class CommitEmployeeImportUseCase {
  constructor(
    private readonly transactions: EmployeeImportTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  execute(command: CommitEmployeeImportCommand): Promise<EmployeeImportCommit> {
    return this.transactions.runCommit(
      {
        companyId: command.companyId,
        userId: command.userId,
        key: command.key,
        fingerprint: command.fingerprint,
      },
      async (scope) => {
        if (!(await scope.authorize(command.businessId)))
          throw new EmployeeImportError('FORBIDDEN');
        const preview = await scope.load(command.previewId);
        if (preview === null || preview.business_id !== command.businessId)
          throw new EmployeeImportError('IMPORT_PREVIEW_NOT_FOUND');
        if (preview.committed_at !== null) throw new EmployeeImportError('IMPORT_PREVIEW_USED');
        if (new Date(preview.expires_at).getTime() <= this.clock.now().getTime())
          throw new EmployeeImportError('IMPORT_PREVIEW_EXPIRED');
        if (preview.errors.length > 0)
          throw new EmployeeImportError('IMPORT_PREVIEW_HAS_ERRORS');
        const present = new Set((await scope.branches(preview.business_id)).map((b) => b.id));
        const at = this.clock.now().toISOString();
        const records = preview.rows.map((row): EmployeeRecord => {
          if (!present.has(row.primary_branch_id))
            throw new EmployeeImportError('EMPLOYEE_BRANCH_NOT_FOUND');
          const record: EmployeeRecord = {
            id: this.ids.newId(),
            business_id: preview.business_id,
            primary_branch_id: row.primary_branch_id,
            name_ar: row.name_ar,
            name_en: row.name_en,
            role_code: row.role_code,
            hire_date: row.hire_date,
            contract_end: row.contract_end,
            user_id: null,
            created_at: at,
          };
          validateEmployeeCreation(record, {
            businessExists: true,
            branchBusinessId: preview.business_id,
          });
          return record;
        });
        await scope.insert(records);
        await scope.summary(
          preview.id,
          preview.business_id,
          records.map((record) => record.id),
        );
        await scope.markCommitted(preview.id);
        return {
          preview_id: preview.id,
          created_count: records.length,
          employee_ids: records.map((record) => record.id),
        };
      },
    );
  }
}
