import { cellText, type ImportCell } from './package-import-cells.ts';
import {
  parsePackageImportRow,
  indexPackageImportServices,
  type PackageImportService,
  type ParsedPackageImportRow,
  type PackageImportRowError,
} from './package-import-row.ts';
import type { PackageImportValidation } from './package-import.ts';

/** نتائج تحليل الملف قبل ربط العملاء، وهواتفها لا تغادر ذاكرة المعاينة. */
export interface PackageImportParsed {
  readonly rows: readonly ParsedPackageImportRow[];
  readonly errors: readonly PackageImportRowError[];
  readonly skipped: PackageImportValidation['skipped'];
}
/**
 * يفحص الصفوف وتكرار المرجع حتى لو كان أحد الصفوف المكررة معطوباً.
 *
 * @param sheet صفوف Excel الفعلية بترتيب العناوين المرجعي
 * @param services خدمات النشاط
 * @param existingRefs مراجع مستوردة سابقة تتخطى تحقق المحتوى
 * @returns صفوف محللة وأخطاء آمنة
 */
export function parsePackageImportSheet(
  sheet: readonly { row: number; cells: readonly ImportCell[] }[],
  services: readonly PackageImportService[],
  existingRefs: readonly string[] = [],
): PackageImportParsed {
  const counts = new Map<string, number>();
  for (const source of sheet) {
    const ref = cellText(source.cells[5] ?? null);
    if (ref !== null) counts.set(ref, (counts.get(ref) ?? 0) + 1);
  }
  const rows: ParsedPackageImportRow[] = [];
  const errors: PackageImportRowError[] = [];
  const skipped: PackageImportValidation['skipped'][number][] = [];
  const existing = new Set(existingRefs);
  const serviceIndex = indexPackageImportServices(services);
  for (const source of sheet) {
    const ref = cellText(source.cells[5] ?? null);
    if (ref !== null && (counts.get(ref) ?? 0) > 1) {
      errors.push({
        row: source.row,
        column: 'external_ref',
        code: 'IMPORT_EXTERNAL_REF_DUPLICATE',
      });
      continue;
    }
    if (ref !== null && existing.has(ref)) {
      skipped.push({ row: source.row, external_ref: ref });
      continue;
    }
    const parsed = parsePackageImportRow(source.row, source.cells, serviceIndex);
    errors.push(...parsed.errors);
    if (parsed.value !== null) rows.push(parsed.value);
  }
  return { rows, errors, skipped };
}
/**
 * يزيل الهواتف قبل التخزين ويعلّم المرجع الموجود كتخطي؛ المراجع الجديدة تتطلب عميلاً معروفاً.
 *
 * @param parsed الصفوف المحللة وأخطاؤها
 * @param customers نتائج دفعة العملاء بنفس ترتيب الصفوف
 * @returns معاينة آمنة بلا هاتف كامل
 */
export function resolvePackageImportRows(
  parsed: PackageImportParsed,
  customers: readonly ({ id: string; phone_last3: string } | null)[],
): PackageImportValidation {
  if (customers.length !== parsed.rows.length)
    throw new Error('PACKAGE_IMPORT_LOOKUP_LENGTH_INVALID');
  const rows: PackageImportValidation['rows'][number][] = [];
  const skipped: PackageImportValidation['skipped'][number][] = [...parsed.skipped];
  const errors = [...parsed.errors];
  parsed.rows.forEach((source, index) => {
    const customer = customers[index];
    if (customer === null || customer === undefined) {
      errors.push({ row: source.row, column: 'customer_phone', code: 'IMPORT_CUSTOMER_NOT_FOUND' });
      return;
    }
    const { row, name_en, name_ar, price_paid, expires_on, external_ref, components } = source;
    const safeRow = { row, name_en, name_ar, price_paid, expires_on, external_ref, components };
    rows.push({ ...safeRow, customer_id: customer.id, phone_last3: customer.phone_last3 });
  });
  return { rows, errors, skipped };
}
