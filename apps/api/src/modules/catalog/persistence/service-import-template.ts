import { t, type MessageKey } from '@pospay/i18n';
import ExcelJS from 'exceljs';

import { readWorkbookSheet } from '../../../shared/import/xlsx-sheet-reader.ts';
import { ServiceImportError } from '../domain/errors.ts';
import {
  SERVICE_IMPORT_MAX_BYTES,
  SERVICE_IMPORT_MAX_COLUMNS,
  SERVICE_IMPORT_MAX_DATA_ROWS,
} from '../domain/service-import.ts';
import {
  SERVICE_IMPORT_TEMPLATE_HEADERS,
  type ServiceImportTemplateHeader,
} from '../domain/service-import-template.ts';
import type {
  ServiceImportCategoryOption,
  ServiceImportTemplateBuilder,
} from '../ports/service-import.port.ts';

// القالب سجل المرجع للنشاط: حد الأوراق اثنان (البيانات والمرجع) لأن المعاينة تعيد قراءة القالب نفسه (A-13).
const TEMPLATE_BOUNDS = {
  maxBytes: SERVICE_IMPORT_MAX_BYTES,
  maxDataRows: SERVICE_IMPORT_MAX_DATA_ROWS,
  maxColumns: SERVICE_IMPORT_MAX_COLUMNS,
  maxWorksheets: 2,
};

// تسميات أعمدة البيانات بالعربية توضع تعليقاً على خلية العنوان فلا تختلط بصفوف البيانات (072 A-3).
const HEADER_NOTES: Record<ServiceImportTemplateHeader, MessageKey> = {
  name_en: 'catalogServiceImport.column_name_en',
  name_ar: 'catalogServiceImport.column_name_ar',
  price: 'catalogServiceImport.column_price',
  duration_minutes: 'catalogServiceImport.column_duration_minutes',
  category: 'catalogServiceImport.column_category',
  commission_rule: 'catalogServiceImport.column_commission_rule',
  commission_value: 'catalogServiceImport.column_commission_value',
  counts_toward_threshold: 'catalogServiceImport.column_counts_toward_threshold',
};

type ReferenceNoteKey =
  | 'reference_category_en'
  | 'reference_category_ar'
  | 'reference_commission_rule'
  | 'reference_commission_value'
  | 'reference_counts_toward_threshold'
  | 'reference_rule_follow_plan'
  | 'reference_rule_zero'
  | 'reference_rule_pct'
  | 'reference_rule_fixed'
  | 'reference_boolean_spellings';

const referenceNote = (key: ReferenceNoteKey): string =>
  t('ar', `catalogServiceImport.${key}`);

// صفوف المرجع الثابتة: العناوين ثم قواعد العمولة الأربع ثم كتابات الاحتساب، وكل تصنيف مفتوح صف بعدها.
function referenceRows(categories: readonly ServiceImportCategoryOption[]): string[][] {
  const rows: string[][] = [
    [
      referenceNote('reference_category_en'),
      referenceNote('reference_category_ar'),
      referenceNote('reference_commission_rule'),
      referenceNote('reference_commission_value'),
      referenceNote('reference_counts_toward_threshold'),
    ],
    ['', '', 'FOLLOW_PLAN', referenceNote('reference_rule_follow_plan'), ''],
    ['', '', 'ZERO', referenceNote('reference_rule_zero'), ''],
    ['', '', 'PCT', referenceNote('reference_rule_pct'), ''],
    ['', '', 'FIXED', referenceNote('reference_rule_fixed'), ''],
    ['', '', '', '', referenceNote('reference_boolean_spellings')],
  ];
  for (const category of categories)
    rows.push([category.name_en, category.name_ar ?? '', '', '', '']);
  return rows;
}

/**
 * يبني قالب استيراد الخدمات ويمرّر الناتج على القارئ المحمي نفسه قبل التنزيل (P-3):
 * ورقة البيانات بعناوينها الثمانية وتعليقاتها العربية، وورقة المرجع بقواعد العمولة
 * وكتابات الاحتساب وكل التصنيفات المفتوحة بلا قصّ، ورفض القارئ للحصص رفض تنزيل مسمّى.
 *
 * @param categories تصنيفات النشاط المفتوحة بأسمائها
 * @returns المصنف مشفّراً بـ base64
 */
export function createServiceImportTemplateBuilder(): ServiceImportTemplateBuilder {
  return {
    build: async (categories) => {
      const workbook = new ExcelJS.Workbook();
      workbook.created = new Date(0);
      const sheet = workbook.addWorksheet('services', { views: [{ rightToLeft: true }] });
      SERVICE_IMPORT_TEMPLATE_HEADERS.forEach((header, position) => {
        const cell = sheet.getCell(1, position + 1);
        cell.value = header;
        cell.font = { bold: true };
        cell.note = { texts: [{ text: t('ar', HEADER_NOTES[header]) }] };
      });
      const reference = workbook.addWorksheet('reference', { views: [{ rightToLeft: true }] });
      for (const row of referenceRows(categories)) reference.addRow(row);
      const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
      try {
        const roundTrip = await readWorkbookSheet(bytes, TEMPLATE_BOUNDS);
        const headers = roundTrip.matrix[0]?.map((cell) => String(cell ?? '').trim()) ?? [];
        const expected = SERVICE_IMPORT_TEMPLATE_HEADERS as readonly string[];
        const formatsAligned = roundTrip.formats.length === roundTrip.matrix.length;
        if (
          !formatsAligned ||
          headers.length !== expected.length ||
          expected.some((header, position) => headers[position] !== header)
        )
          throw new ServiceImportError('IMPORT_TEMPLATE_EXCEEDS_LIMITS');
      } catch (error) {
        if (error instanceof ServiceImportError) throw error;
        if (error instanceof Error && error.name === 'ImportWorkbookError')
          throw new ServiceImportError('IMPORT_TEMPLATE_EXCEEDS_LIMITS');
        throw error;
      }
      return Buffer.from(bytes).toString('base64');
    },
  };
}
