import {
  ImportWorkbookError,
  readWorkbookMatrix as readSharedWorkbook,
} from '@pospay/import-workbooks';
import type { ImportMatrix } from '../../../shared/import/import-sheet.ts';
import {
  EMPLOYEE_IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  EMPLOYEE_IMPORT_HEADERS,
  EmployeeImportError,
} from '../domain/employee-import.ts';
/** يحافظ على حدود الموظفين وهوية أخطائهم بعد نقل المحرك التقني.
 *
 * @param bytes بايتات المصنف
 * @returns مصفوفة الخلايا بأرقام الصفوف الأصلية
 */
export async function readWorkbookMatrix(bytes: Uint8Array): Promise<ImportMatrix> {
  try {
    return await readSharedWorkbook(bytes, {
      maxBytes: EMPLOYEE_IMPORT_MAX_BYTES,
      maxDataRows: IMPORT_MAX_ROWS,
      maxColumns: EMPLOYEE_IMPORT_HEADERS.length + 2,
      maxWorksheets: 4,
    });
  } catch (error) {
    if (error instanceof ImportWorkbookError) throw new EmployeeImportError(error.code);
    throw error;
  }
}
