import { expect, it } from 'vitest';
import {
  createXlsxExpansion,
  guardWorkbookXml,
  guardWorksheetXml,
  rowLimitExceeded,
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

it('rejects any element nested inside a defined name before ExcelJS closes it early', () => {
  const xml = Buffer.from(
    '<workbook><sheets><sheet name="employees" r:id="rId1"/></sheets><definedNames>' +
      '<definedName name="x">employees!$A$1:$H$1048576<sheet name="decoy"/>' +
      '<definedName name="y">employees!$A$1</definedName></definedName></definedNames></workbook>',
  );
  expect(() => guardWorkbookXml(xml, bounds)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it.each([
  '<sheetData><row r="1000000000"><c r="A1"><v>1</v></c></row></sheetData>',
  '<sheetData><row r="1"><c r="A1000000000"><v>1</v></c></row></sheetData>',
  '<sheetData><row r="x"/></sheetData>',
])('rejects row and cell positions past the Excel grid: %s', (xml) => {
  expect(() => guardWorksheetXml(worksheet(xml), bounds)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it.each([
  '<sheetData><row r="503"/></sheetData>',
  '<sheetData><row r="2"><c r="A503"/></row></sheetData>',
  `<sheetData>${'<row/>'.repeat(503)}</sheetData>`,
  '<dimension ref="A1:F1000"/>',
])('reports rows past the import limit with the row-limit error on the data sheet: %s', (xml) => {
  const dataSheet = () =>
    guardWorksheetXml(worksheet(xml), bounds, createXlsxExpansion(), rowLimitExceeded);
  expect(dataSheet).toThrow('IMPORT_ROW_LIMIT_EXCEEDED');
  expect(() => guardWorksheetXml(worksheet(xml), bounds)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it('keeps a far merge range on the generic content error', () => {
  expect(() => guardWorksheetXml(worksheet('<mergeCell ref="A1:A600"/>'), bounds)).toThrow(
    'IMPORT_FILE_CONTENT_INVALID',
  );
});

it.each(['1000000000', '100000', '0', 'x'])(
  'rejects a sheetId that would size the worksheet array: %s',
  (sheetId) => {
    const xml = Buffer.from(
      `<workbook><sheets><sheet name="employees" sheetId="${sheetId}" r:id="rId1"/></sheets></workbook>`,
    );
    expect(() => guardWorkbookXml(xml, bounds)).toThrow('IMPORT_FILE_CONTENT_INVALID');
  },
);

it('accepts the sheet ids Excel writes after sheets are added and removed', () => {
  const xml = Buffer.from(
    '<workbook><sheets><sheet name="employees" sheetId="1" r:id="rId1"/>' +
      '<sheet name="reference" sheetId="7" r:id="rId2"/></sheets></workbook>',
  );
  expect(() => guardWorkbookXml(xml, bounds)).not.toThrow();
});
