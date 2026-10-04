import { inflateRawSync } from 'node:zlib';

const MAX_EXPANDED_BYTES = 20 * 1024 * 1024;
const INVALID = () => new Error('IMPORT_FILE_CONTENT_INVALID');

function directory(bytes: Buffer): { start: number; end: number; entries: number } {
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65_557); at -= 1) {
    if (bytes.readUInt32LE(at) !== 0x06054b50) continue;
    if (at + 22 + bytes.readUInt16LE(at + 20) !== bytes.length) continue;
    const entries = bytes.readUInt16LE(at + 10);
    const start = bytes.readUInt32LE(at + 16);
    const end = start + bytes.readUInt32LE(at + 12);
    if (bytes.readUInt32LE(at + 4) !== 0 || entries === 0xffff || end !== at) throw INVALID();
    return { start, end, entries };
  }
  throw INVALID();
}

// الحجم المعلن وحده لا يكفي: نفك كل جزء بحد فعلي حتى لا يمر ZIP بحجم مركزي مزور إلى exceljs.
export function guardXlsxZip(bytes: Buffer): void {
  const central = directory(bytes);
  let at = central.start;
  let total = 0;
  for (let entry = 0; entry < central.entries; entry += 1) {
    if (at + 46 > central.end || bytes.readUInt32LE(at) !== 0x02014b50) throw INVALID();
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const expanded = bytes.readUInt32LE(at + 24);
    const local = bytes.readUInt32LE(at + 42);
    if ((flags & 1) !== 0 || expanded > MAX_EXPANDED_BYTES - total || local + 30 > central.start)
      throw INVALID();
    if (bytes.readUInt32LE(local) !== 0x04034b50) throw INVALID();
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    if (start + compressed > central.start) throw INVALID();
    const content = bytes.subarray(start, start + compressed);
    const actual =
      method === 0
        ? content.length
        : method === 8
          ? inflateRawSync(content, { maxOutputLength: Math.max(1, MAX_EXPANDED_BYTES - total) })
              .length
          : -1;
    if (actual !== expanded) throw INVALID();
    total += actual;
    at +=
      46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  if (at !== central.end) throw INVALID();
}
