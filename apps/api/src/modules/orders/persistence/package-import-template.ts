import { ImportWorkbookError, readWorkbookMatrix } from '@pospay/import-workbooks';
import { t } from '@pospay/i18n';
import ExcelJS from 'exceljs';

import {
  PACKAGE_IMPORT_TEMPLATE_BOUNDS,
  PACKAGE_IMPORT_TEMPLATE_HEADERS,
  PackageImportTemplateError,
} from '../domain/package-import-template.ts';
import type { PackageImportTemplateBuilder } from '../ports/package-import-template.port.ts';

type NoteKey =
  | 'customer_phone'
  | 'name_en'
  | 'name_ar'
  | 'price_paid'
  | 'expires_on'
  | 'external_ref'
  | 'service'
  | 'sessions'
  | 'remaining';

// تسمية العمود بالعربية تُوضع تعليقاً على خلية العنوان بعد حذف اللاحقة الرقمية، فلا تختلط بصفوف البيانات.
const noteOf = (header: string): string =>
  t('ar', `packageImport.${header.replace(/_\d+$/, '') as NoteKey}`);

// أي رفض من القارئ المحمي أو اختلاف في العناوين بعد الرجوع هو رفض تنزيل مسمّى، لا ملف لا يُقبل رفعه.
function exceeds(): PackageImportTemplateError {
  return new PackageImportTemplateError('IMPORT_TEMPLATE_EXCEEDS_LIMITS');
}

/**
 * يبني قالب استيراد الباقات ويمرّره على القارئ المحمي نفسه قبل التنزيل: ورقة الباقات بعناوينها الستة
 * والستين وتعليقاتها العربية، وورقة الخدمات بكل الخدمات المفتوحة بلا قصّ، ورفض القارئ أو اختلاف
 * العناوين رفض تنزيل مسمّى.
 *
 * @returns بنّاء القالب
 */
export function createPackageImportTemplateBuilder(): PackageImportTemplateBuilder {
  return {
    build: async (services) => {
      const workbook = new ExcelJS.Workbook();
      workbook.created = new Date(0);
      const sheet = workbook.addWorksheet('packages', { views: [{ rightToLeft: true }] });
      PACKAGE_IMPORT_TEMPLATE_HEADERS.forEach((header, position) => {
        const cell = sheet.getCell(1, position + 1);
        cell.value = header;
        cell.font = { bold: true };
        cell.note = { texts: [{ text: noteOf(header) }] };
      });
      const reference = workbook.addWorksheet('services', { views: [{ rightToLeft: true }] });
      reference.addRow([
        t('ar', 'packageImport.reference_service_en'),
        t('ar', 'packageImport.reference_service_ar'),
      ]);
      for (const service of services) reference.addRow([service.name_en, service.name_ar ?? '']);
      const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
      try {
        const matrix = await readWorkbookMatrix(bytes, PACKAGE_IMPORT_TEMPLATE_BOUNDS);
        const headers = matrix[0]?.map((cell) => String(cell ?? '').trim()) ?? [];
        if (
          headers.length !== PACKAGE_IMPORT_TEMPLATE_HEADERS.length ||
          PACKAGE_IMPORT_TEMPLATE_HEADERS.some((header, position) => headers[position] !== header)
        )
          throw exceeds();
      } catch (error) {
        if (error instanceof PackageImportTemplateError) throw error;
        if (error instanceof ImportWorkbookError) throw exceeds();
        throw error;
      }
      return Buffer.from(bytes).toString('base64');
    },
  };
}
