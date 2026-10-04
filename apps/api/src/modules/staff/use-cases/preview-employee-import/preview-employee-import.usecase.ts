import type { EmployeeImportPreview } from '@pospay/contracts';

import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import {
  EMPLOYEE_IMPORT_HEADERS,
  EMPLOYEE_IMPORT_MAX_BYTES,
  EmployeeImportError,
  branchNameIndex,
  validateEmployeeImportFile,
} from '../../domain/employee-import.ts';
import type {
  EmployeeImportTransactions,
  ImportSheetReader,
  ObjectBytesReader,
} from '../../ports/employee-import.port.ts';
import { readSheet } from '../../../../shared/import/import-sheet.ts';
import { validateEmployeeImport } from './employee-import.validator.ts';

export { EmployeeImportError } from '../../domain/employee-import.ts';

const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

export interface PreviewEmployeeImportCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly fileId: string;
}

// يعاين استيراد الموظفين: يقرأ الملف الموثّق ويتحقق من كل صف دون كتابة أي موظف.
export class PreviewEmployeeImportUseCase {
  constructor(
    private readonly transactions: EmployeeImportTransactions,
    private readonly bytes: ObjectBytesReader,
    private readonly sheets: ImportSheetReader,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: PreviewEmployeeImportCommand): Promise<EmployeeImportPreview> {
    const { storageKey, branches } = await this.transactions.runPreview(
      command,
      async (scope) => {
        if (!(await scope.authorize(command.businessId)))
          throw new EmployeeImportError('FORBIDDEN');
        const facts = await scope.fileFacts(command.fileId);
        validateEmployeeImportFile(facts, command.businessId, command.userId);
        if (facts === null || facts.storage_key === null)
          throw new EmployeeImportError('IMPORT_FILE_NOT_FOUND');
        return { storageKey: facts.storage_key, branches: await scope.branches(command.businessId) };
      },
    );
    const matrix = await this.sheets.read(
      await this.bytes.read(storageKey, EMPLOYEE_IMPORT_MAX_BYTES + 1),
    );
    const sheet = readSheet(matrix, EMPLOYEE_IMPORT_HEADERS);
    if (sheet === 'IMPORT_HEADER_INVALID')
      throw new EmployeeImportError('IMPORT_HEADER_INVALID');
    if (sheet === 'IMPORT_ROW_LIMIT_EXCEEDED')
      throw new EmployeeImportError('IMPORT_ROW_LIMIT_EXCEEDED');
    const { rows, errors } = validateEmployeeImport(sheet, branchNameIndex(branches));
    const previewId = this.ids.newId();
    const at = this.clock.now();
    await this.transactions.runPreview(command, async (scope) => {
      if (!(await scope.authorize(command.businessId))) throw new EmployeeImportError('FORBIDDEN');
      await scope.save({
        id: previewId,
        businessId: command.businessId,
        entity: 'employees',
        fileId: command.fileId,
        createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + PREVIEW_TTL_MS).toISOString(),
        rows,
        errors,
      });
    });
    return {
      preview_id: previewId,
      row_count: rows.length,
      error_count: errors.length,
      errors: [...errors],
    };
  }
}
