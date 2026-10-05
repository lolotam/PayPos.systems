import { employeeRoleCode } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import ExcelJS from 'exceljs';

import { EMPLOYEE_IMPORT_HEADERS } from '../domain/employee-import.ts';

// العناوين الإنجليزية هي المرجع، والعربية توضع كتعليق على خلية العنوان فلا تختلط بصفوف البيانات.
const ARABIC_LABELS: Record<(typeof EMPLOYEE_IMPORT_HEADERS)[number], MessageKey> = {
  name_en: 'employeeImport.column_name_en',
  name_ar: 'employeeImport.column_name_ar',
  role_code: 'employeeImport.column_role_code',
  hire_date: 'employeeImport.column_hire_date',
  contract_end: 'employeeImport.column_contract_end',
  primary_branch: 'employeeImport.column_primary_branch',
};

export interface TemplateBranch {
  readonly name_en: string;
  readonly name_ar: string | null;
}

/** يبني قالب الموظفين لفروع نشاط واحد؛ الورقة الأولى للبيانات والثانية مرجع الفروع والأدوار. */
export async function buildEmployeeImportTemplate(
  branches: readonly TemplateBranch[],
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(0);
  const sheet = workbook.addWorksheet('employees', { views: [{ rightToLeft: true }] });
  EMPLOYEE_IMPORT_HEADERS.forEach((header, position) => {
    const cell = sheet.getCell(1, position + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.note = { texts: [{ text: t('ar', ARABIC_LABELS[header]) }] };
  });
  const reference = workbook.addWorksheet('reference', { views: [{ rightToLeft: true }] });
  reference.addRow(['branch_en', 'branch_ar', 'role_code']);
  for (
    let index = 0;
    index < Math.max(branches.length, employeeRoleCode.options.length);
    index += 1
  ) {
    const branch = branches[index];
    reference.addRow([
      branch?.name_en ?? '',
      branch?.name_ar ?? '',
      employeeRoleCode.options[index] ?? '',
    ]);
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
