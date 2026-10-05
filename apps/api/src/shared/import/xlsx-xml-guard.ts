export interface XlsxStructureBounds {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxWorksheets: number;
}

// 65536 موضعاً تتجاوز ستة أمثال شبكة البيانات (502×8) ومرجع 2000 فرع (2001×3)
// معاً، فتترك هامشاً لنطاقات الحفظ المعتادة؛ جمع التكرارات يمنع تضخيم زيارات الخلايا.
export const XLSX_EXPANSION_BUDGET = 65_536;
export interface XlsxExpansion {
  used: number;
  firstRelationship?: string;
  readonly sheetBounds: Map<string, XlsxStructureBounds>;
}
export const createXlsxExpansion = (): XlsxExpansion => ({ used: 0, sheetBounds: new Map() });
const invalid = () => new Error('IMPORT_FILE_CONTENT_INVALID');

function charge(expansion: XlsxExpansion, amount: number): void {
  expansion.used += amount;
  if (expansion.used > XLSX_EXPANSION_BUDGET) throw invalid();
}

function column(letters: string): number {
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function coordinates(address: string, bounds: XlsxStructureBounds) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/.exec(address);
  if (match?.[1] === undefined || match[2] === undefined) throw invalid();
  const col = column(match[1]);
  const row = Number(match[2]);
  if (row > bounds.maxRows || col > bounds.maxColumns) throw invalid();
  return { row, column: col };
}

function range(ref: string, bounds: XlsxStructureBounds): number {
  if (ref.length > 32) throw invalid();
  const addresses = ref.split(':');
  const firstAddress = addresses[0];
  if (addresses.length > 2 || firstAddress === undefined) throw invalid();
  const first = coordinates(firstAddress, bounds);
  const last = coordinates(addresses[1] ?? firstAddress, bounds);
  if (first.row > last.row || first.column > last.column) throw invalid();
  return (last.row - first.row + 1) * (last.column - first.column + 1);
}

// رفض الكيانات يمنع اختلاف القيمة التي نتحقق منها عن القيمة المفكوكة لدى ExcelJS.
export function xmlAttribute(
  attributes: string,
  name: string,
  required = true,
): string | undefined {
  let value: string | undefined;
  for (const attribute of attributes.matchAll(
    /(?:^|\s)([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g,
  )) {
    if (attribute[1] !== name) continue;
    if (value !== undefined) throw invalid();
    value = (attribute[2] ?? '').slice(1, -1);
    if (value.includes('&')) throw invalid();
  }
  if (required && value === undefined) throw invalid();
  return value;
}

export function referenceBounds(bounds: XlsxStructureBounds): XlsxStructureBounds {
  return { ...bounds, maxRows: Math.floor(XLSX_EXPANSION_BUDGET / bounds.maxColumns) };
}

function xmlText(content: Buffer): string {
  const xml = content.toString('utf8');
  if (xml.includes('\0') || /<!DOCTYPE/i.test(xml)) throw invalid();
  return xml;
}

function columns(attributes: string, bounds: XlsxStructureBounds, expansion: XlsxExpansion): void {
  const min = xmlAttribute(attributes, 'min') ?? '';
  const max = xmlAttribute(attributes, 'max') ?? '';
  if (!/^[1-9][0-9]{0,4}$/.test(min) || !/^[1-9][0-9]{0,4}$/.test(max)) throw invalid();
  if (Number(min) > Number(max) || Number(max) > bounds.maxColumns) throw invalid();
  // Column.fromModel ينشئ الفجوات قبل min أيضاً؛ max حد محافظ حتى مع تداخل التصريحات.
  charge(expansion, Number(max));
}

export function guardWorksheetXml(
  content: Buffer,
  bounds: XlsxStructureBounds,
  expansion: XlsxExpansion = createXlsxExpansion(),
): void {
  const tags = xmlText(content).matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?(dimension|mergeCell|dataValidation|col)\b([^<>]*)>/g,
  );
  for (const tag of tags) {
    const attributes = tag[2] ?? '';
    if (tag[1] === 'col') {
      columns(attributes, bounds, expansion);
      continue;
    }
    const value = xmlAttribute(attributes, tag[1] === 'dataValidation' ? 'sqref' : 'ref') ?? '';
    // نحسب مساحة dimension تحفظياً؛ ولا نحذف التكرارات التي يعيد ExcelJS زيارة خلاياها.
    let ranges = 0;
    for (const ref of value.matchAll(/\S+/g)) {
      charge(expansion, range(ref[0], bounds));
      ranges += 1;
    }
    if (ranges === 0) throw invalid();
  }
}

function printRange(ref: string, bounds: XlsxStructureBounds): void {
  const rows = /^\$?([1-9][0-9]{0,6}):\$?([1-9][0-9]{0,6})$/.exec(ref);
  const cols = /^\$?([A-Z]{1,3}):\$?([A-Z]{1,3})$/.exec(ref);
  if (rows !== null || cols !== null) {
    const first = rows !== null ? Number(rows[1]) : column(cols?.[1] ?? '');
    const last = rows !== null ? Number(rows[2]) : column(cols?.[2] ?? '');
    if (first > last || last > (rows !== null ? bounds.maxRows : bounds.maxColumns))
      throw invalid();
    return;
  }
  range(ref, bounds);
}

function definedName(
  formula: string,
  name: string,
  bounds: XlsxStructureBounds,
  expansion: XlsxExpansion,
): void {
  if (/[<&]/.test(formula) || formula.length === 0) throw invalid();
  const references = /(?:(?:'((?:[^']|'')*)'|([^!,\s]+))!)?([$A-Z0-9:]+)(?:,|$)/gy;
  let end = 0;
  for (const match of formula.matchAll(references)) {
    const sheet = (match[1] ?? match[2] ?? '').replace(/''/g, "'");
    const sheetBounds = expansion.sheetBounds.get(sheet) ?? bounds;
    const ref = match[3] ?? '';
    // workbook-xform يزيل اسمي الطباعة قبل DefinedNames.addEx؛ هما بيانات صفحة بلا توسع خلايا.
    if (name === '_xlnm.Print_Titles') printRange(ref, sheetBounds);
    else if (name === '_xlnm.Print_Area') range(ref, sheetBounds);
    else charge(expansion, range(ref, sheetBounds));
    end = match.index + match[0].length;
  }
  if (end !== formula.length) throw invalid();
}

export function guardWorkbookXml(
  content: Buffer,
  bounds: XlsxStructureBounds,
  expansion: XlsxExpansion = createXlsxExpansion(),
): void {
  const xml = xmlText(content);
  const tags = /<((?:[A-Za-z_][\w.-]*:)?)(sheet|definedName)\b([^<>]*)>/g;
  let count = 0;
  for (let tag = tags.exec(xml); tag !== null; tag = tags.exec(xml)) {
    const attributes = tag[3] ?? '';
    if (tag[2] === 'sheet') {
      count += 1;
      if (count > bounds.maxWorksheets) throw invalid();
      const name = xmlAttribute(attributes, 'name') ?? '';
      const relation = xmlAttribute(attributes, 'r:id', false);
      if (count === 1 && relation !== undefined) expansion.firstRelationship = relation;
      expansion.sheetBounds.set(name, count === 1 ? bounds : referenceBounds(bounds));
    } else {
      const closing = `</${tag[1] ?? ''}definedName>`;
      const end = xml.indexOf(closing, tags.lastIndex);
      if (end === -1) throw invalid();
      const name = xmlAttribute(attributes, 'name') ?? '';
      xmlAttribute(attributes, 'localSheetId', false);
      definedName(xml.slice(tags.lastIndex, end), name, bounds, expansion);
      tags.lastIndex = end + closing.length;
    }
  }
}
