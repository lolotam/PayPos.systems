import { t, type MessageKey } from '@pospay/i18n';
import ExcelJS from 'exceljs';

import {
  readWorkbookSheet,
  ImportWorkbookError,
} from '../../../shared/import/xlsx-sheet-reader.ts';
import { CUSTOMER_IMPORT_COLUMNS, CustomerImportError } from '../domain/customer-import.ts';
import type { CustomerImportTemplateBuilder } from '../ports/customer-import.port.ts';
import { CUSTOMER_IMPORT_READER_BOUNDS } from './drizzle-customer-import.ts';

// تعليقات العناوين بالعربية تُوضع تعليقاً على خلية العنوان فلا تختلط بصفوف البيانات (072 A-3).
const HEADER_NOTES: Record<(typeof CUSTOMER_IMPORT_COLUMNS)[number], MessageKey> = {
  name: 'customerImport.column_name',
  phone: 'customerImport.column_phone',
  country_code: 'customerImport.column_country_code',
  locale: 'customerImport.column_locale',
  no_rating: 'customerImport.column_no_rating',
  birthday: 'customerImport.column_birthday',
  year_known: 'customerImport.column_year_known',
  gender: 'customerImport.column_gender',
  email: 'customerImport.column_email',
  notes: 'customerImport.column_notes',
};

/** يمرّر القالب على القارئ المحمي نفسه قبل التنزيل: العناوين العشرة بترتيبها المرجعي، وحدود الحجم والورقتين (073 D-8). */
async function verifyTemplate(bytes: Uint8Array): Promise<void> {
  try {
    const roundTrip = await readWorkbookSheet(bytes, CUSTOMER_IMPORT_READER_BOUNDS);
    const headers = roundTrip.matrix[0]?.map((cell) => String(cell ?? '').trim()) ?? [];
    const aligned = roundTrip.formats.length === roundTrip.matrix.length;
    if (
      !aligned ||
      headers.length !== CUSTOMER_IMPORT_COLUMNS.length ||
      CUSTOMER_IMPORT_COLUMNS.some((header, position) => headers[position] !== header)
    )
      throw new CustomerImportError('IMPORT_TEMPLATE_EXCEEDS_LIMITS');
  } catch (error) {
    if (error instanceof CustomerImportError) throw error;
    if (error instanceof ImportWorkbookError)
      throw new CustomerImportError('IMPORT_TEMPLATE_EXCEEDS_LIMITS');
    throw error;
  }
}

async function buildVerifiedTemplateBase64(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(0);
  const sheet = workbook.addWorksheet('customers', { views: [{ rightToLeft: true }] });
  CUSTOMER_IMPORT_COLUMNS.forEach((header, position) => {
    const cell = sheet.getCell(1, position + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.note = { texts: [{ text: t('ar', HEADER_NOTES[header]) }] };
  });
  const reference = workbook.addWorksheet('reference', { views: [{ rightToLeft: true }] });
  for (const header of CUSTOMER_IMPORT_COLUMNS)
    reference.addRow([header, t('ar', HEADER_NOTES[header])]);
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  await verifyTemplate(bytes);
  return Buffer.from(bytes).toString('base64');
}

/**
 * يبني قالب استيراد العملاء: ورقة بيانات بعناوينها العشرة وتعليقاتها العربية، وورقة مرجعية
 * بتشرح كل عمود بنفس التعليق، والحماية المحمية بتتحقق من الناتج قبل التنزيل (073 D-8).
 *
 * @returns المصنف مشفّراً بـ base64
 */
export function createCustomerImportTemplateBuilder(): CustomerImportTemplateBuilder {
  let cached: Promise<string> | null = null;
  return {
    build: () => {
      if (cached === null) {
        cached = buildVerifiedTemplateBase64().catch((error: unknown) => {
          cached = null;
          throw error;
        });
      }
      return cached;
    },
  };
}
