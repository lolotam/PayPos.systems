import type { ReadSheetResult } from '../../../../shared/import/import-sheet.ts';
import type { TaggedImportCell, TaggedImportMatrix } from '../../../../shared/import/tag-cells.ts';
import type { ServiceImportSheetInput } from '../../domain/service-import-row.ts';

/** نص الخلية الموسومة كما يقرأه المحوّل: نص أو رقم بنصّه المشذب، وغيرهما بلا نصّ بحث. */
function cellLookupText(cell: TaggedImportCell): string | null {
  if (cell === null) return null;
  if (cell.kind === 'text' || cell.kind === 'numeric') return cell.text.trim();
  return null;
}

/**
 * بيربط صفوف `readSheet` بأرقام صفوفها الأصلية بخلاياها الموسومة من تمريرة القارئ الواحدة (P-2):
 * الربط بم number الصف الأصلي من `sourceRows` لا بالرقم المتتابع بعد حذف الفراغات، ولا إعادة
 * فك ضغط الملف، فخرج الورقة هو مدخل المماسّر الثابت في A-12 كما هو.
 *
 * @param sheet  نتيجة `readSheet` بعناوينها وصفوفها الموجودة بأرقامها الأصلية
 * @param tagged مصفوفة الورقة كاملة بخلاياها الموسومة و`sourceRows` نفسها
 * @returns مدخل المماسّر: العناوين المشذبة وصفوف موسومة بأرقامها الأصلية
 */
export function joinTaggedSheetRows(
  sheet: ReadSheetResult,
  tagged: TaggedImportMatrix,
): ServiceImportSheetInput {
  const sourceRows = tagged.sourceRows ?? [];
  const byRow = new Map<number, readonly TaggedImportCell[]>();
  tagged.forEach((cells, index) => {
    const original = sourceRows[index];
    if (original !== undefined) byRow.set(original, cells);
  });
  return {
    headers: sheet.headers,
    rows: sheet.rows.map(({ row }) => {
      const cells = byRow.get(row) ?? [];
      return { row, cells };
    }),
  };
}

/** بنصوص التصنيفات المطلّقة من الخلايا الموسومة للعمود المعنون `category`، بلا تكرار وبترتيب الورقة. */
export function distinctCategoryLabels(
  sheet: ServiceImportSheetInput,
): readonly string[] {
  const position = sheet.headers.indexOf('category');
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const row of sheet.rows) {
    const text = cellLookupText(row.cells[position] ?? null);
    if (text === null || text === '' || seen.has(text)) continue;
    seen.add(text);
    labels.push(text);
  }
  return labels;
}
