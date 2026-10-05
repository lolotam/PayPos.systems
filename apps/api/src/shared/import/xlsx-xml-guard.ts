import { SaxesParser, type SaxesTagPlain } from 'saxes';

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
// صف أبعد من الحد في ملف سليم غالباً معناه ملف فيه صفوف كتير، فالمستخدم يشوف رسالة حد الصفوف
// المفهومة بدل "محتوى غير صالح"؛ الرفض نفسه بيحصل في الحالتين قبل ما ExcelJS يحمّل حاجة.
export const rowLimitExceeded = () => new Error('IMPORT_ROW_LIMIT_EXCEEDED');
const EXCEL_MAX_ROW = 1_048_576;

function boundRow(row: number, bounds: XlsxStructureBounds, overflow = invalid): void {
  if (row > EXCEL_MAX_ROW) throw invalid();
  if (row > bounds.maxRows) throw overflow();
}

function charge(expansion: XlsxExpansion, amount: number): void {
  expansion.used += amount;
  if (expansion.used > XLSX_EXPANSION_BUDGET) throw invalid();
}

function column(letters: string): number {
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

function coordinates(address: string, bounds: XlsxStructureBounds, overflow = invalid) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/.exec(address);
  if (match?.[1] === undefined || match[2] === undefined) throw invalid();
  const col = column(match[1]);
  const row = Number(match[2]);
  if (col > bounds.maxColumns) throw invalid();
  boundRow(row, bounds, overflow);
  return { row, column: col };
}

function range(ref: string, bounds: XlsxStructureBounds, overflow = invalid): number {
  if (ref.length > 32) throw invalid();
  const addresses = ref.split(':');
  const firstAddress = addresses[0];
  if (addresses.length > 2 || firstAddress === undefined) throw invalid();
  const first = coordinates(firstAddress, bounds, overflow);
  const last = coordinates(addresses[1] ?? firstAddress, bounds, overflow);
  if (first.row > last.row || first.column > last.column) throw invalid();
  return (last.row - first.row + 1) * (last.column - first.column + 1);
}

export function referenceBounds(bounds: XlsxStructureBounds): XlsxStructureBounds {
  return { ...bounds, maxRows: Math.floor(XLSX_EXPANSION_BUDGET / bounds.maxColumns) };
}

function scanXml(
  content: Buffer,
  open: (tag: SaxesTagPlain) => void,
  text: (value: string) => void = () => undefined,
  close: (tag: SaxesTagPlain) => void = () => undefined,
): void {
  // نفس خيارات ExcelJS تمنع اختلاف تفسير الاقتباسات والكيانات وأسماء الوسوم بين الفحص والتحميل.
  const parser = new SaxesParser();
  parser.on('opentag', open);
  parser.on('text', text);
  parser.on('closetag', close);
  parser.on('doctype', () => {
    throw invalid();
  });
  parser.on('error', () => {
    throw invalid();
  });
  parser.write(content.toString('utf8')).close();
}

function columns(
  attributes: Record<string, string>,
  bounds: XlsxStructureBounds,
  expansion: XlsxExpansion,
): void {
  const min = attributes['min'] ?? '';
  const max = attributes['max'] ?? '';
  if (!/^[1-9][0-9]{0,4}$/.test(min) || !/^[1-9][0-9]{0,4}$/.test(max)) throw invalid();
  if (Number(min) > Number(max) || Number(max) > bounds.maxColumns) throw invalid();
  // Column.fromModel ينشئ الفجوات قبل min أيضاً؛ max حد محافظ حتى مع تداخل التصريحات.
  charge(expansion, Number(max));
}

export function guardWorksheetXml(
  content: Buffer,
  bounds: XlsxStructureBounds,
  expansion: XlsxExpansion = createXlsxExpansion(),
  rowOverflow: () => Error = invalid,
): void {
  let rows = 0;
  scanXml(content, (tag) => {
    if (tag.name === 'col') {
      columns(tag.attributes, bounds, expansion);
      return;
    }
    // Worksheet._parseRows بيحط الصف في _rows[r - 1] و eachRow بيلف على طول المصفوفة كلها،
    // فرقم صف ضخم في ملف صغير يعمل مصفوفة طولها مليار؛ نحد الأرقام الفعلية وعدد الصفوف.
    if (tag.name === 'row') {
      rows += 1;
      boundRow(rows, bounds, rowOverflow);
      const number = tag.attributes['r'];
      if (number === undefined) return;
      if (!/^[1-9][0-9]{0,6}$/.test(number)) throw invalid();
      boundRow(Number(number), bounds, rowOverflow);
      return;
    }
    if (tag.name === 'c') {
      const address = tag.attributes['r'];
      if (address !== undefined) coordinates(address, bounds, rowOverflow);
      return;
    }
    if (!['dimension', 'mergeCell', 'dataValidation'].includes(tag.name)) return;
    const value = tag.attributes[tag.name === 'dataValidation' ? 'sqref' : 'ref'] ?? '';
    // نحسب مساحة dimension تحفظياً؛ ولا نحذف التكرارات التي يعيد ExcelJS زيارة خلاياها.
    const overflow = tag.name === 'dimension' ? rowOverflow : invalid;
    let ranges = 0;
    for (const ref of value.matchAll(/\S+/g)) {
      charge(expansion, range(ref[0], bounds, overflow));
      ranges += 1;
    }
    if (ranges === 0) throw invalid();
  });
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
  if (formula.length === 0) throw invalid();
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
  let count = 0;
  let current: { name: string; text: string[] } | undefined;
  scanXml(
    content,
    (tag) => {
      // DefinedNameXform بيقفل الاسم عند أي closetag، فعنصر جوه definedName بيخلّي ExcelJS والفحص
      // يشوفوا نطاقات مختلفة؛ أي عنصر جوه الاسم مرفوض قبل ما نفرّق بين sheet و definedName.
      if (current !== undefined) throw invalid();
      if (tag.name === 'sheet') {
        count += 1;
        if (count > bounds.maxWorksheets) throw invalid();
        // Workbook بيحط الورقة في _worksheets[sheetId] و worksheets بيلف على طول المصفوفة،
        // فـ sheetId ضخم يعمل مصفوفة طولها مليار؛ Excel بيزوّده بس مع إضافة/حذف أوراق.
        const sheetId = tag.attributes['sheetId'];
        if (sheetId !== undefined && !/^[1-9][0-9]{0,4}$/.test(sheetId)) throw invalid();
        const name = tag.attributes['name'] ?? '';
        const relation = tag.attributes['r:id'];
        if (count === 1 && relation !== undefined) expansion.firstRelationship = relation;
        expansion.sheetBounds.set(name, count === 1 ? bounds : referenceBounds(bounds));
      } else if (tag.name === 'definedName') {
        current = { name: tag.attributes['name'] ?? '', text: [] };
      }
    },
    (text) => {
      // DefinedNameXform يجمع أحداث النص عبر التعليقات؛ ولا يستمع إلى أحداث CDATA.
      current?.text.push(text);
    },
    (tag) => {
      if (tag.name !== 'definedName' || current === undefined) return;
      definedName(current.text.join(''), current.name, bounds, expansion);
      current = undefined;
    },
  );
}

export function worksheetRelationshipPath(content: Buffer, id: string): string | undefined {
  let path: string | undefined;
  scanXml(content, (tag) => {
    if (tag.name === 'Relationship' && tag.attributes['Id'] === id) {
      const target = tag.attributes['Target'] ?? '';
      path = `xl/${target.replace(/^(\s|\/xl\/)+/, '')}`;
    }
  });
  return path;
}
