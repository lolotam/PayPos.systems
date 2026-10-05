import { expect, it } from 'vitest';
import {
  createXlsxExpansion,
  guardWorkbookXml,
  guardWorksheetXml,
} from '../import/xlsx-xml-guard.ts';

const bounds = { maxRows: 502, maxColumns: 8, maxWorksheets: 4 };
const worksheet = (xml: string) => Buffer.from(`<worksheet>${xml}</worksheet>`);

it.each([
  `<dataValidation prompt=" sqref='A1' >" sqref="A1:H1048576"/>`,
  `<col customWidth=" min='1' max='1' >" min="1" max="1048576"/>`,
  `<mergeCell other=" ref='A1' >" ref="A1:H1048576"/>`,
  `<dimension other=" ref='A1' >" ref="A1:H1048576"/>`,
])('rejects quoted greater-than attribute spoofing: %s', (xml) => {
  expect(() => guardWorksheetXml(worksheet(xml), bounds)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it('concatenates defined-name text across comments like ExcelJS', () => {
  const expansion = createXlsxExpansion();
  guardWorkbookXml(
    Buffer.from(
      '<workbook><definedNames><definedName name="x">employees!$A$1:<!--c-->$H$502</definedName></definedNames></workbook>',
    ),
    bounds,
    expansion,
  );
  expect(expansion.used).toBe(4016);
});

it('charges entity-decoded reference attributes at their decoded area', () => {
  const expansion = createXlsxExpansion();
  guardWorksheetXml(worksheet('<dataValidation sqref="A1:&#72;502"/>'), bounds, expansion);
  expect(expansion.used).toBe(4016);
});

it('rejects malformed XML before loading the workbook', () => {
  expect(() =>
    guardWorksheetXml(Buffer.from('<worksheet><dimension ref="A1"/><broken></worksheet>'), bounds),
  ).toThrow('IMPORT_FILE_CONTENT_INVALID');
});
