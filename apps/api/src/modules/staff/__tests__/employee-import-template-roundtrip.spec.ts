import { inflateRawSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { archiveParts } from '../../../shared/__tests__/xlsx-zip.fixture.ts';
import { buildEmployeeImportTemplate } from '../persistence/employee-import-template.ts';
import { readWorkbookMatrix } from '../persistence/xlsx-sheet-reader.ts';

function parts(bytes: Uint8Array) {
  const zip = Buffer.from(bytes);
  let at = zip.readUInt32LE(zip.length - 6);
  const result: { name: string; content: string }[] = [];
  while (zip.readUInt32LE(at) === 0x02014b50) {
    const nameSize = zip.readUInt16LE(at + 28);
    const local = zip.readUInt32LE(at + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const compressed = zip.subarray(start, start + zip.readUInt32LE(at + 20));
    const inflated = zip.readUInt16LE(at + 10) === 8 ? inflateRawSync(compressed) : compressed;
    result.push({
      name: zip.subarray(at + 46, at + 46 + nameSize).toString(),
      content: inflated.toString(),
    });
    at += 46 + nameSize + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return result;
}

it('round-trips the template with 2000 reference branches through the full guarded reader', async () => {
  const bytes = await buildEmployeeImportTemplate(
    Array.from({ length: 2000 }, (_, index) => ({
      name_en: `Branch ${index}`,
      name_ar: `فرع ${index}`,
    })),
  );
  expect(await readWorkbookMatrix(bytes)).toHaveLength(1);
});

it('round-trips the generated template with Excel-added print titles', async () => {
  const entries = parts(await buildEmployeeImportTemplate([]));
  const workbook = entries.find((entry) => entry.name === 'xl/workbook.xml');
  if (workbook === undefined) throw new Error('WORKBOOK_MISSING');
  workbook.content = workbook.content.replace(
    '</workbook>',
    '<definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">employees!$1:$1,employees!$A:$B</definedName></definedNames></workbook>',
  );
  expect(await readWorkbookMatrix(archiveParts(entries))).toHaveLength(1);
});
