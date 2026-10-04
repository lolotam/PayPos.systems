import { createEmployeeInput } from '@pospay/contracts';
import {
  employeeImportInputs,
  validateEmployeeImport as validateRows,
} from '../../domain/employee-import-row.ts';
import type { ReadSheetResult } from '../../../../shared/import/import-sheet.ts';

// العقد يظل على حافة التطبيق؛ قواعد الصف وتسمية الأخطاء تظل داخل المجال.
export function validateEmployeeImport(
  sheet: ReadSheetResult,
  branches: ReadonlyMap<string, string>,
) {
  const validations = employeeImportInputs(sheet, branches).map((input) => {
    const parsed = createEmployeeInput.safeParse(input);
    if (!parsed.success)
      return {
        success: false as const,
        issues: parsed.error.issues.map((issue) => String(issue.path[0])),
      };
    return {
      success: true as const,
      data: {
        ...parsed.data,
        name_ar: parsed.data.name_ar ?? null,
        contract_end: parsed.data.contract_end ?? null,
      },
    };
  });
  return validateRows(sheet, branches, validations);
}
