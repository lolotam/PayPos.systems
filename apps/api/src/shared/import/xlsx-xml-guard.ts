export interface XlsxStructureBounds {
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxWorksheets: number;
}

const invalid = () => new Error('IMPORT_FILE_CONTENT_INVALID');
const MAX_LISTED_RANGES = 16;
const MAX_DEFINED_NAMES = 32;

function coordinates(address: string, bounds: XlsxStructureBounds) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})$/.exec(address);
  const letters = match?.[1];
  const digits = match?.[2];
  if (letters === undefined || digits === undefined) throw invalid();
  const column = [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  const row = Number(digits);
  if (row > bounds.maxRows || column > bounds.maxColumns) throw invalid();
  return { row, column };
}

function range(ref: string, bounds: XlsxStructureBounds) {
  if (ref.length > 32) throw invalid();
  const addresses = ref.split(':');
  const firstAddress = addresses[0];
  if (addresses.length > 2 || firstAddress === undefined) throw invalid();
  const first = coordinates(firstAddress, bounds);
  const last = coordinates(addresses[1] ?? firstAddress, bounds);
  if (first.row > last.row || first.column > last.column) throw invalid();
}

function attributeValues(attributes: string, name: string): string[] {
  const values: string[] = [];
  for (const attribute of attributes.matchAll(
    /(?:^|\s)([A-Za-z_][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g,
  )) {
    if (attribute[1] === name) values.push((attribute[2] ?? '').slice(1, -1));
  }
  return values;
}

// لا نفك كيانات داخل ref: الصيغة الضيقة تمنع تمويه نطاق ضخم عن الفحص قبل توسع ExcelJS.
// ExcelJS بيفرد mergeCell و sqref بتاع dataValidation خلية خلية، فكل نطاق لازم يكون جوه الحدود.
export function guardWorksheetXml(content: Buffer, bounds: XlsxStructureBounds): void {
  const xml = content.toString('utf8');
  if (xml.includes('\0') || /<!DOCTYPE/i.test(xml)) throw invalid();
  const tags = xml.matchAll(
    /<(?:[A-Za-z_][\w.-]*:)?(dimension|mergeCell|dataValidation)\b([^<>]*)>/g,
  );
  for (const tag of tags) {
    const values = attributeValues(tag[2] ?? '', tag[1] === 'dataValidation' ? 'sqref' : 'ref');
    if (values.length !== 1) throw invalid();
    const ranges = (values[0] ?? '').trim().split(/\s+/);
    if (ranges.length > MAX_LISTED_RANGES) throw invalid();
    for (const ref of ranges) range(ref, bounds);
  }
}

// الأسماء المعرّفة بتتفرد خلية خلية وقت التحميل (DefinedNames.addEx)، فنقبل بس مراجع خلايا كاملة
// جوه الحدود؛ مرجع عمود أو صف كامل ($A:$A أو $1:$1) أو صيغة ديناميكية بيترفض.
function guardDefinedName(formula: string, bounds: XlsxStructureBounds): void {
  const local = formula.replace(/'(?:[^']|'')*'!/g, '').replace(/[A-Za-z_][\w.]*!/g, '');
  if (local.length > 256 || local.includes('&')) throw invalid();
  for (const token of local.matchAll(/[$A-Z0-9]+(?::[$A-Z0-9]+)?/g)) {
    if (!/^[0-9]+$/.test(token[0])) range(token[0], bounds);
  }
}

export function guardWorkbookXml(content: Buffer, bounds: XlsxStructureBounds): void {
  const xml = content.toString('utf8');
  if (xml.includes('\0') || /<!DOCTYPE/i.test(xml)) throw invalid();
  let count = 0;
  const sheets = xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b/g);
  while (!sheets.next().done) {
    count += 1;
    if (count > bounds.maxWorksheets) throw invalid();
  }
  const names = [...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?definedName\b[^<>]*>([^<]*)</g)];
  if (names.length > MAX_DEFINED_NAMES) throw invalid();
  for (const name of names) guardDefinedName(name[1] ?? '', bounds);
}
