import { deflateRawSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { guardXlsxZip } from '../import/xlsx-zip-guard.ts';

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
