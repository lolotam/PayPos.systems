import { expect, it } from 'vitest';
import { guardWorkbookXml, guardWorksheetXml } from '../import/xlsx-xml-guard.ts';

const bounds = { maxRows: 502, maxColumns: 8, maxWorksheets: 4 };
const guard = (xml: string) =>
  guardWorksheetXml(Buffer.from(`<worksheet>${xml}</worksheet>`), bounds);

it('accepts structural boundaries and either quote style', () => {
  expect(() =>
    guard('<worksheet><dimension ref="A1:H502"/><mergeCell ref=\'A1:B2\'/></worksheet>'),
  ).not.toThrow();
});

it.each([
  '<dimension other=\'ref="A1:F2"\' ref="A1:XFD1048576"/>',
  '<mergeCell ref="A1:&#88;FD1048576"/>',
  '<mergeCell ref="A1:H502" ref="A1:XFD1048576"/>',
  '<mergeCell ref="H502:A1"/>',
])('rejects disguised or ambiguous range metadata %s', (xml) => {
  expect(() => guard(xml)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it('bounds malformed attribute scanning without allocating a range-sized matrix', () => {
  const start = performance.now();
  expect(() => guard(`<dimension ${'A'.repeat(128 * 1024)}/>`)).toThrow(
    'IMPORT_FILE_CONTENT_INVALID',
  );
  expect(performance.now() - start).toBeLessThan(1000);
});

it.each([
  '<dataValidation type="list" sqref="A1:XFD1048576"/>',
  '<dataValidation sqref="C2:C502 A1:XFD1048576"/>',
])('rejects data validation ranges ExcelJS would expand cell by cell %s', (xml) => {
  expect(() => guard(xml)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it('ignores namespaced and differently-cased tags ignored by ExcelJS handlers', () => {
  expect(() =>
    guard('<x14:dataValidation sqref="A1:A1048576"/><DataValidation sqref="A1:A1048576"/>'),
  ).not.toThrow();
});

it('accepts data validation ranges inside the template bounds', () => {
  expect(() => guard('<dataValidation type="list" sqref="C2:C502 D2:D502"/>')).not.toThrow();
});

const workbook = (names: string) =>
  guardWorkbookXml(
    Buffer.from(
      `<workbook><sheets><sheet name="A"/></sheets><definedNames>${names}</definedNames></workbook>`,
    ),
    bounds,
  );

it('accepts defined names that reference cells inside the bounds', () => {
  expect(() =>
    workbook(`<definedName name="roles">'Reference sheet'!$A$2:$A$14</definedName>`),
  ).not.toThrow();
});

it.each([
  '<definedName name="all">Sheet1!$A$1:$XFD$1048576</definedName>',
  '<definedName name="col">Sheet1!$A:$A</definedName>',
  '<definedName name="row">Sheet1!$1:$1048576</definedName>',
  '<definedName name="dyn">OFFSET(Sheet1!$A$1,0,0,1048576,1)</definedName>',
])('rejects defined names ExcelJS would expand cell by cell %s', (names) => {
  expect(() => workbook(names)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});
