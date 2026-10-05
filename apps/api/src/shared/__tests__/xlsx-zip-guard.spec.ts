import { deflateRawSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { guardXlsxZip } from '../import/xlsx-zip-guard.ts';
import { archiveParts } from './xlsx-zip.fixture.ts';

function zip(expanded: number, declared = expanded) {
  const compressed = deflateRawSync(Buffer.alloc(expanded, 65));
  const local = Buffer.alloc(31);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(1, 26);
  local[30] = 97;
  const central = Buffer.alloc(47);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(1, 28);
  central[46] = 97;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

it('rejects more than 5 MiB expansion including forged central-directory sizes', () => {
  const size = 5 * 1024 * 1024 + 1;
  expect(() => guardXlsxZip(zip(size))).toThrow();
  expect(() => guardXlsxZip(zip(size, 100))).toThrow();
});

it('accepts bounded expansion and rejects truncation', () => {
  const bytes = zip(100);
  expect(() => guardXlsxZip(bytes)).not.toThrow();
  expect(() => guardXlsxZip(bytes.subarray(0, bytes.length - 1))).toThrow();
});

it('rejects a second central directory hidden in the EOCD comment with a trailing byte', () => {
  const bytes = zip(100);
  const firstEnd = bytes.length - 22;
  const start = bytes.readUInt32LE(firstEnd + 16);
  const hiddenDirectory = Buffer.from(bytes.subarray(start, firstEnd));
  const hiddenEnd = Buffer.from(bytes.subarray(firstEnd));
  hiddenEnd.writeUInt32LE(bytes.length, 16);
  bytes.writeUInt16LE(hiddenDirectory.length + hiddenEnd.length + 1, firstEnd + 20);
  const ambiguous = Buffer.concat([bytes, hiddenDirectory, hiddenEnd, Buffer.from([0])]);
  expect(() => guardXlsxZip(ambiguous)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it('accepts an ordinary EOF-aligned ZIP comment and rejects bytes beyond it', () => {
  const bytes = zip(100);
  const comment = Buffer.from('synthetic comment');
  bytes.writeUInt16LE(comment.length, bytes.length - 2);
  const archive = Buffer.concat([bytes, comment]);
  expect(() => guardXlsxZip(archive)).not.toThrow();
  expect(() => guardXlsxZip(Buffer.concat([archive, Buffer.from([0])]))).toThrow(
    'IMPORT_FILE_CONTENT_INVALID',
  );
});

it('rejects mismatched directory counts and ZIP64 sentinels', () => {
  const counts = zip(100);
  counts.writeUInt16LE(2, counts.length - 22 + 8);
  expect(() => guardXlsxZip(counts)).toThrow('IMPORT_FILE_CONTENT_INVALID');
  const zip64 = zip(100);
  zip64.writeUInt32LE(0xffffffff, zip64.length - 22 + 16);
  expect(() => guardXlsxZip(zip64)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it.each([
  'xl//worksheets/sheet2.xml',
  'prefix/xl/worksheets/sheet2.xml',
  'xl/worksheets/sheet2.xml.suffix',
])('rejects worksheet path aliases parsed by ExcelJS %s', (name) => {
  const bytes = archiveParts([
    {
      name,
      content: '<worksheet><mergeCell ref="A1:XFD1048576"/></worksheet>',
    },
  ]);
  expect(() => guardXlsxZip(bytes, { maxRows: 502, maxColumns: 8, maxWorksheets: 4 })).toThrow(
    'IMPORT_FILE_CONTENT_INVALID',
  );
});
