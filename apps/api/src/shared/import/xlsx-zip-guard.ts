import { inflateRawSync } from 'node:zlib';
import { guardWorkbookXml, guardWorksheetXml, type XlsxStructureBounds } from './xlsx-xml-guard.ts';

const MAX_EXPANDED_BYTES = 5 * 1024 * 1024;
const INVALID = () => new Error('IMPORT_FILE_CONTENT_INVALID');

function directory(bytes: Buffer): { start: number; end: number; entries: number } {
  const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const at = bytes.indexOf(signature);
  if (at < 0 || bytes.indexOf(signature, at + 1) !== -1 || at + 22 > bytes.length) throw INVALID();
  if (at + 22 + bytes.readUInt16LE(at + 20) !== bytes.length) throw INVALID();
  if (
    bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x06])) ||
    bytes.includes(Buffer.from([0x50, 0x4b, 0x06, 0x07]))
  )
    throw INVALID();
  const entries = bytes.readUInt16LE(at + 10);
  const start = bytes.readUInt32LE(at + 16);
  const size = bytes.readUInt32LE(at + 12);
  if (
    bytes.readUInt32LE(at + 4) !== 0 ||
    entries === 0xffff ||
    bytes.readUInt16LE(at + 8) !== entries ||
    start === 0xffffffff ||
    size === 0xffffffff ||
    start + size !== at
  )
    throw INVALID();
  return { start, end: at, entries };
}

function extraFields(bytes: Buffer): void {
  let at = 0;
  while (at < bytes.length) {
    if (at + 4 > bytes.length) throw INVALID();
    const type = bytes.readUInt16LE(at);
    const end = at + 4 + bytes.readUInt16LE(at + 2);
    // ZIP64 أو اسم Unicode بديل يسمحان للمحلل باختيار حجم/مسار مختلف عما فحصناه.
    if (type === 1 || type === 0x7075 || end > bytes.length) throw INVALID();
    at = end;
  }
}

function inflateEntry(
  bytes: Buffer,
  at: number,
  central: { start: number; end: number },
  total: number,
) {
  if (at + 46 > central.end || bytes.readUInt32LE(at) !== 0x02014b50) throw INVALID();
  const flags = bytes.readUInt16LE(at + 8);
  const method = bytes.readUInt16LE(at + 10);
  const compressed = bytes.readUInt32LE(at + 20);
  const expanded = bytes.readUInt32LE(at + 24);
  const local = bytes.readUInt32LE(at + 42);
  const nameSize = bytes.readUInt16LE(at + 28);
  const entryEnd = at + 46 + nameSize + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  if (
    entryEnd > central.end ||
    compressed === 0xffffffff ||
    local === 0xffffffff ||
    bytes.readUInt16LE(at + 34) !== 0
  )
    throw INVALID();
  const name = bytes.subarray(at + 46, at + 46 + nameSize);
  const path = name.toString('utf8');
  if (
    path.includes('\\') ||
    path.includes('//') ||
    path.startsWith('/') ||
    path.split('/').some((part) => part === '.' || part === '..')
  )
    throw INVALID();
  extraFields(bytes.subarray(at + 46 + nameSize, entryEnd - bytes.readUInt16LE(at + 32)));
  if ((flags & 1) !== 0 || expanded > MAX_EXPANDED_BYTES - total || local + 30 > central.start)
    throw INVALID();
  if (bytes.readUInt32LE(local) !== 0x04034b50) throw INVALID();
  if (
    bytes.readUInt16LE(local + 6) !== flags ||
    bytes.readUInt16LE(local + 8) !== method ||
    !name.equals(bytes.subarray(local + 30, local + 30 + bytes.readUInt16LE(local + 26)))
  )
    throw INVALID();
  const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
  if (start + compressed > central.start) throw INVALID();
  extraFields(bytes.subarray(local + 30 + bytes.readUInt16LE(local + 26), start));
  const content = bytes.subarray(start, start + compressed);
  const inflated =
    method === 0
      ? content
      : method === 8
        ? inflateRawSync(content, { maxOutputLength: Math.max(1, MAX_EXPANDED_BYTES - total) })
        : null;
  if (inflated === null || inflated.length !== expanded) throw INVALID();
  return { path, inflated, next: entryEnd };
}

// الحجم المعلن وحده لا يكفي: نفك كل جزء بحد فعلي حتى لا يمر ZIP بحجم مركزي مزور إلى exceljs.
export function guardXlsxZip(bytes: Buffer, bounds?: XlsxStructureBounds): void {
  const central = directory(bytes);
  let at = central.start;
  let total = 0;
  let worksheets = 0;
  const paths = new Set<string>();
  for (let entry = 0; entry < central.entries; entry += 1) {
    const { path, inflated, next } = inflateEntry(bytes, at, central, total);
    if (paths.has(path)) throw INVALID();
    paths.add(path);
    // ExcelJS يطابق اسم الورقة دون مراسي؛ نفحص أيضاً الأسماء ذات بادئة/لاحقة كي لا تفلت ورقة محملة.
    const worksheet =
      /^xl\/worksheets\/[^/]+\.xml$/.test(path) || /xl\/worksheets\/sheet\d+[.]xml/.test(path);
    if (bounds !== undefined && worksheet) {
      worksheets += 1;
      if (worksheets > bounds.maxWorksheets) throw INVALID();
      guardWorksheetXml(inflated, bounds);
    }
    if (bounds !== undefined && path === 'xl/workbook.xml') guardWorkbookXml(inflated, bounds);
    total += inflated.length;
    at = next;
  }
  if (at !== central.end) throw INVALID();
}
