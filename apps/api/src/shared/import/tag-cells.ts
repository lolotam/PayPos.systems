import { INVALID_CELL, type ImportMatrix } from './import-sheet.ts';

/** خلايا القارئ بعد حد الأرقام؛ النص محفوظ والخطأ لا يتحول إلى قيمة افتراضية. */
export type TaggedImportCell =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'numeric'; readonly text: string; readonly percentFormat: boolean }
  | { readonly kind: 'numeric-unrepresentable'; readonly display: string }
  | { readonly kind: 'error' }
  | null;

/** نفس إحداثيات الورقة وأرقام صفوفها الأصلية، بلا أرقام في حمولة الخلايا. */
export type TaggedImportMatrix = readonly (readonly TaggedImportCell[])[] & {
  readonly sourceRows?: readonly number[];
};

type FormatMatrix = readonly (readonly (string | null | undefined)[] | null | undefined)[];

function hasPercentFormat(format: string | null | undefined): boolean {
  if (format == null) return false;
  let quoted = false;
  for (let index = 0; index < format.length; index += 1) {
    const character = format[index];
    if (quoted) {
      if (character === '"') quoted = false;
      continue;
    }
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === ';') break;
    if (character === '_' || character === '*') {
      index += 1;
      continue;
    }
    if (character === '%') return true;
  }
  return false;
}

function tagCell(cell: unknown, format: string | null | undefined): TaggedImportCell {
  if (cell === null) return null;
  if (cell === INVALID_CELL) return { kind: 'error' };
  if (typeof cell === 'string') return { kind: 'text', text: cell };
  if (typeof cell === 'boolean') return { kind: 'boolean', value: cell };
  if (typeof cell !== 'number' || !Number.isFinite(cell)) return { kind: 'error' };
  const text = String(cell);
  const digits = text.replace(/[-.]/g, '').replace(/^0+/, '');
  const significantDigits = (text.includes('.') ? digits : digits.replace(/0+$/, '')).length;
  if (/[eE]/.test(text) || significantDigits > 15)
    return { kind: 'numeric-unrepresentable', display: text };
  return { kind: 'numeric', text, percentFormat: hasPercentFormat(format) };
}

/**
 * يحفظ قيمة القارئ كنص قصير قابل للاسترجاع، ويترك التحويل والتحقق لمستورد الكيان.
 * التنسيق الغائب يعني عدم وجود نسبة، ولا يغيّر ترتيب الصفوف أو الأعمدة.
 *
 * @param matrix خلايا القارئ مع أرقام الصفوف الأصلية إن وجدت
 * @param formats تنسيقات بنفس الإحداثيات؛ الخانات أو الصفوف الغائبة بلا تنسيق
 * @returns مصفوفة جديدة بخلايا موسومة ونسخة مستقلة من أرقام الصفوف الأصلية
 */
export function tagCells(matrix: ImportMatrix, formats?: FormatMatrix | null): TaggedImportMatrix {
  const tagged = matrix.map((row, rowIndex) =>
    row.map((cell, columnIndex) => tagCell(cell, formats?.[rowIndex]?.[columnIndex])),
  );
  if (matrix.sourceRows !== undefined)
    return Object.assign(tagged, { sourceRows: [...matrix.sourceRows] });
  return tagged;
}
