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
import {
  mapServiceImportRows,
  type ServiceImportNormalizedRow,
  type ServiceImportRowIssue,
  type ServiceImportSheetInput,
} from '../../domain/service-import-row.ts';
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

/**
 * يقسم حالات الأسماء القادمة من PostgreSQL إلى مجموعتي الإقصاء: صفوف التكرار داخل الملف،
 * وصفوف الوجود في النشاط بلا تكرار؛ قرار الاسمين معاً من قاعدة البيانات وحدها (FR-007).
 */
function nameConflictSets(
  mapping: ReturnType<typeof mapServiceImportRows>,
  states: readonly { readonly duplicate_in_file: boolean; readonly exists: boolean }[],
): { readonly duplicates: ReadonlySet<number>; readonly exists: ReadonlySet<number> } {
  const duplicates = new Set(
    mapping.keys
      .filter((_, index) => states[index]?.duplicate_in_file === true)
      .map(({ row }) => row),
  );
  const exists = new Set(
    mapping.keys
      .filter((key, index) => states[index]?.exists === true && !duplicates.has(key.row))
      .map(({ row }) => row),
  );
  return { duplicates, exists };
}

/** يقسم حالات الأسماء القادمة من PostgreSQL إلى أخطاء التسمية المدمجة وصفوف الإقصاء (D-8). */
function resolveNameConflicts(
  input: ServiceImportSheetInput,
  mapping: ReturnType<typeof mapServiceImportRows>,
  states: readonly { readonly duplicate_in_file: boolean; readonly exists: boolean }[],
): { readonly errors: readonly ServiceImportRowIssue[]; readonly rows: readonly ServiceImportNormalizedRow[] } {
  const { duplicates, exists } = nameConflictSets(mapping, states);
  const errors = mergeNameErrors(input, mapping.errors, [
    ...[...duplicates].map((row) => ({ row, code: 'IMPORT_DUPLICATE_IN_FILE' as const })),
    ...[...exists].map((row) => ({ row, code: 'IMPORT_SERVICE_EXISTS' as const })),
  ]);
  const conflicts = new Set([...duplicates, ...exists]);
  return { errors, rows: mapping.rows.filter((row) => !conflicts.has(row.row)) };
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

// أخطاء التكرار داخل الملف والوجود في النشاط تُدمج مع أخطاء الورقة بترتيب الصف في الورقة ثم
// موضع العمود المرجعي نفسه (D-8)، ورمز التكرار يسبق رمز الوجود لصف لا يحمله الاثنان معاً.
function mergeNameErrors(
  input: ServiceImportSheetInput,
  errors: readonly ServiceImportRowIssue[],
  nameIssues: readonly { row: number; code: 'IMPORT_DUPLICATE_IN_FILE' | 'IMPORT_SERVICE_EXISTS' }[],
): ServiceImportRowIssue[] {
  const rowPosition = new Map(input.rows.map(({ row }, index) => [row, index]));
  const columnPosition = new Map(input.headers.map((header, index) => [header, index]));
  const headerCount = input.headers.length;
  const merged = [
    ...errors,
    ...nameIssues.map((issue) => ({ row: issue.row, column: 'name_en' as const, code: issue.code })),
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
    // الوصول للملف الخاص وقع بقراءة البايتات، فالتدقيق يُثبَّت في معاملته المستقلة قبل أي عمل
    // آخر: فشل التحليل أو فشل المطابقة والحفظ لا يمسحه بالتراجع (CLAUDE.md §8، P2 مراجعة 1186).
    await this.auditAccess(command);
    const parsed = parseSheet(await this.sheets.read(bytes));
    const input = joinTaggedSheetRows(parsed.sheet, parsed.tagged);
    const labels = distinctCategoryLabels(input);
    const previewId = this.ids.newId();
    const at = this.clock.now();
    const expiresAt = new Date(at.getTime() + PREVIEW_TTL_MS).toISOString();
    return this.transactions.runMatchAndSave({ ...command }, (scope) =>
      this.matchAndSave(scope, command, input, labels, { previewId, at: at.toISOString(), expiresAt }),
    );
  }

  /** تدقيق الوصول للملف الخاص في معاملة حقائق مستقلة تُثبَّت فوراً (CLAUDE.md §8). */
  private async auditAccess(command: PreviewServiceImportCommand): Promise<void> {
    await this.transactions.runFacts(command, async (scope) => {
      await scope.auditFileAccess(command.fileId);
    });
  }

  /** المطابقة والحفظ على معاملة واحدة: التصنيفات ثم الأسماء ثم صفوف وأخطاء المعاينة (072 D-4). */
  private async matchAndSave(
    scope: Parameters<Parameters<ServiceImportTransactions['runMatchAndSave']>[1]>[0],
    command: PreviewServiceImportCommand,
    input: ServiceImportSheetInput,
    labels: readonly string[],
    ids: { readonly previewId: string; readonly at: string; readonly expiresAt: string },
  ): Promise<ServiceImportPreview> {
    const matches = await scope.matchCategories(labels);
    const resolved = new Map(matches.map((match) => [match.label, match]));
    const mapping = mapServiceImportRows(input, (lookupText) => resolved.get(lookupText) ?? null);
    // التكرار داخل الملف والوجود في النشاط قرار PostgreSQL وحده بتعبير الطي الواحد على
    // الطرفين — لا مفتاح جافاسكربت يعارض قاعدة البيانات (FR-007، HIGH مراجعة 1186).
    const states = await scope.matchServiceNames(mapping.keys.map(({ name }) => name));
    const { errors, rows } = resolveNameConflicts(input, mapping, states);
    await scope.save({
      id: ids.previewId,
      businessId: command.businessId,
      fileId: command.fileId,
      createdAt: ids.at,
      expiresAt: ids.expiresAt,
      rowCount: input.rows.length,
      rows,
      errors,
    });
    const firstPage = rows.slice(0, PREVIEW_ROWS_PAGE);
    return {
      preview_id: ids.previewId,
      row_count: input.rows.length,
      error_count: errors.length,
      errors: [...errors],
      rows: firstPage,
      next_cursor: nextCursor(rows, firstPage),
    };
  }
}
