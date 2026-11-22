import type { ServiceImportPreview } from '@pospay/contracts';

import { tagCells, type TaggedImportMatrix } from '../../../../shared/import/tag-cells.ts';
import { readSheet, type SheetIssue } from '../../../../shared/import/import-sheet.ts';
import type { Clock } from '../../../../shared/ports/clock.port.ts';
import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { ServiceImportError } from '../../domain/errors.ts';
import { validateServiceImportFile } from '../../domain/service-import-file.ts';
import {
  SERVICE_IMPORT_MAX_BYTES,
  SERVICE_IMPORT_MAX_DATA_ROWS,
} from '../../domain/service-import.ts';
import { serviceImportExpectedHeaders } from '../../domain/service-import.ts';
import { mapServiceImportRows, type ServiceImportNormalizedRow, type ServiceImportRowIssue, type ServiceImportSheetInput } from '../../domain/service-import-row.ts';
import type {
  ServiceImportObjectBytes,
  ServiceImportSheetReader,
  ServiceImportTransactions,
} from '../../ports/service-import.port.ts';
import { distinctCategoryLabels, joinTaggedSheetRows } from './service-import-sheet.ts';

export { ServiceImportError } from '../../domain/errors.ts';

// المعاينة تنتهي بعد 24 ساعة كأي معاينة استيراد على محرك ADR-0034 نفسه.
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;
const PREVIEW_ROWS_PAGE = 100;

// الصف الأخير في الصفحة هو المؤشر التالي، وغياب صفوف بعد الصفحة الكاملة يعني انتهاء القائمة.
function nextCursor(
  rows: readonly { readonly row: number }[],
  page: readonly unknown[],
): string | null {
  const last = page.at(-1);
  return page.length < rows.length && last !== undefined ? String((last as { row: number }).row) : null;
}

/** نتيجة التحليل المحمي: العناوين وصفوف البيانات الموسومة بأرقامها الأصلية. */
interface ParsedSheet {
  readonly sheet: Exclude<ReturnType<typeof readSheet>, SheetIssue>;
  readonly tagged: TaggedImportMatrix;
}

/** بيطبّع بايتات الورقة المقروءة مرة واحدة: عناوين متوقعة، ثم حدود الصفوف، ثم الربط بالأرقام الأصلية. */
function parseSheet(
  sheetResult: Awaited<ReturnType<ServiceImportSheetReader['read']>>,
): ParsedSheet {
  const tagged: TaggedImportMatrix = tagCells(sheetResult.matrix, sheetResult.formats);
  const expected = serviceImportExpectedHeaders(sheetResult.matrix[0] ?? []);
  const sheet = readSheet(sheetResult.matrix, expected, SERVICE_IMPORT_MAX_DATA_ROWS);
  if (sheet === 'IMPORT_HEADER_INVALID') throw new ServiceImportError('IMPORT_HEADER_INVALID');
  if (sheet === 'IMPORT_ROW_LIMIT_EXCEEDED')
    throw new ServiceImportError('IMPORT_ROW_LIMIT_EXCEEDED');
  return { sheet, tagged };
}

export interface PreviewServiceImportCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly businessId: string;
  readonly fileId: string;
}

// أخطاء الوجود في النشاط تُدمج مع أخطاء الورقة بترتيب الصف في الورقة ثم موضع العمود المرجعي نفسه (D-8).
function mergeServiceExistsErrors(
  input: ServiceImportSheetInput,
  errors: readonly ServiceImportRowIssue[],
  conflictingRows: readonly number[],
): ServiceImportRowIssue[] {
  const rowPosition = new Map(input.rows.map(({ row }, index) => [row, index]));
  const columnPosition = new Map(input.headers.map((header, index) => [header, index]));
  const headerCount = input.headers.length;
  const merged = [
    ...errors,
    ...conflictingRows.map((row) => ({
      row,
      column: 'name_en' as const,
      code: 'IMPORT_SERVICE_EXISTS' as const,
    })),
  ];
  return merged.sort(
    (left, right) =>
      (rowPosition.get(left.row) ?? headerCount) - (rowPosition.get(right.row) ?? headerCount) ||
      (columnPosition.get(left.column) ?? headerCount) -
        (columnPosition.get(right.column) ?? headerCount),
  );
}

/**
 * يعاين استيراد الخدمات من ملف موثّق واحد: يتحقق من الملف ويقرأ بايتاته مرة واحدة خارج أي
 * معاملة قاعدة بيانات، ويطابق التصنيفات والأسماء دفعة واحدة ويحفظ المعاينة في معاملة مستأجر
 * واحدة بلا كتابة أي خدمة أو تدقيق خدمة (072 D-4، A-11، A-12).
 */
export class PreviewServiceImportUseCase {
  constructor(
    private readonly transactions: ServiceImportTransactions,
    private readonly bytes: ServiceImportObjectBytes,
    private readonly sheets: ServiceImportSheetReader,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async execute(command: PreviewServiceImportCommand): Promise<ServiceImportPreview> {
    const storageKey = await this.transactions.runFacts(command, async (scope) => {
      const facts = await scope.fileFacts(command.fileId);
      return validateServiceImportFile(facts, command.businessId, command.userId);
    });
    const bytes = await this.bytes.read(storageKey, SERVICE_IMPORT_MAX_BYTES + 1);
    // دخول تدقيقي حتى لو رفض التحليل البايتات بعدها: الوصول للملف الخاص وقع فعلاً (CLAUDE.md §8).
    let parsed: ParsedSheet;
    try {
      parsed = parseSheet(await this.sheets.read(bytes));
    } catch (error) {
      await this.transactions.runFacts(command, async (scope) => {
        await scope.auditFileAccess(command.fileId);
      });
      throw error;
    }
    const input = joinTaggedSheetRows(parsed.sheet, parsed.tagged);
    const labels = distinctCategoryLabels(input);
    const previewId = this.ids.newId();
    const at = this.clock.now();
    const expiresAt = new Date(at.getTime() + PREVIEW_TTL_MS).toISOString();
    return this.transactions.runMatchAndSave({ ...command }, async (scope) => {
      // الوصول للملف الخاص تدقيق إلزامي في معاملة الحفظ على مسار النجاح (CLAUDE.md §8).
      await scope.auditFileAccess(command.fileId);
      const matches = await scope.matchCategories(labels);
      const resolved = new Map(matches.map((match) => [match.label, match]));
      const mapping = mapServiceImportRows(input, (lookupText) => resolved.get(lookupText) ?? null);
      // المقارنة على الأسماء المطلقة: الطرفان يُطويان داخل PostgreSQL بتعبير واحد (HIGH مراجعة 1186).
      const existing = new Set(await scope.existingServiceKeys(mapping.keys.map(({ name }) => name)));
      const conflicts = conflictingRows(mapping, existing);
      const errors = mergeServiceExistsErrors(input, mapping.errors, conflicts);
      const rows = cleanRows(mapping, conflicts);
      await scope.save({
        id: previewId,
        businessId: command.businessId,
        fileId: command.fileId,
        createdAt: at.toISOString(),
        expiresAt,
        rowCount: input.rows.length,
        rows,
        errors,
      });
      const firstPage = rows.slice(0, PREVIEW_ROWS_PAGE);
      return {
        preview_id: previewId,
        row_count: input.rows.length,
        error_count: errors.length,
        errors: [...errors],
        rows: firstPage,
        next_cursor: nextCursor(rows, firstPage),
      };
    });
  }
}

// التكرار داخل الملف هو سبب الصف الحاسم، فالصفوف المكررة لا تأخذ خطأ الوجود في النشاط فوق رمزه (D-8).
function conflictingRows(
  mapping: ReturnType<typeof mapServiceImportRows>,
  existing: ReadonlySet<string>,
): readonly number[] {
  const inFileDuplicates = new Set(
    mapping.errors
      .filter((issue) => issue.code === 'IMPORT_DUPLICATE_IN_FILE')
      .map((issue) => issue.row),
  );
  return mapping.keys
    .filter(({ name, row }) => existing.has(name) && !inFileDuplicates.has(row))
    .map(({ row }) => row);
}

/** الصفوف النظيفة بعد إقصاء صفوف التكرار داخل الملف وصفوف الوجود في النشاط معاً. */
function cleanRows(
  mapping: ReturnType<typeof mapServiceImportRows>,
  conflicts: readonly number[],
): readonly ServiceImportNormalizedRow[] {
  const conflictRows = new Set(conflicts);
  return mapping.rows.filter((row) => !conflictRows.has(row.row));
}
