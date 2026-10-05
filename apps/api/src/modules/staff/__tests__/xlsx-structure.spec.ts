import ExcelJS from 'exceljs';
import { afterEach, expect, it, vi } from 'vitest';
import { archiveParts } from '../../../shared/__tests__/xlsx-zip.fixture.ts';
import { readWorkbookMatrix } from '../persistence/xlsx-sheet-reader.ts';

afterEach(() => vi.restoreAllMocks());

const sheet = (content: string) =>
  `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${content}</worksheet>`;

function workbookXml(sheets: readonly string[]) {
  const xmlns = 'http://schemas.openxmlformats.org';
  const definitions = sheets
    .map(
      (_, index) =>
        `<sheet name="sheet${index + 1}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');
  const relationships = sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="${xmlns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('');
  return archiveParts([
    {
      name: '[Content_Types].xml',
      content: `<Types xmlns="${xmlns}/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      content: `<Relationships xmlns="${xmlns}/package/2006/relationships"><Relationship Id="rId1" Type="${xmlns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `<workbook xmlns="${xmlns}/spreadsheetml/2006/main" xmlns:r="${xmlns}/officeDocument/2006/relationships"><sheets>${definitions}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `<Relationships xmlns="${xmlns}/package/2006/relationships">${relationships}</Relationships>`,
    },
    ...sheets.map((content, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: sheet(content),
    })),
  ]);
}

it('loads a bounded crafted workbook without the loader stub', async () => {
  const bytes = workbookXml([
    '<dimension ref="A1:F2"/><sheetData/>',
    '<dimension ref="A1:F2"/><sheetData/>',
  ]);
  expect(await readWorkbookMatrix(bytes)).toHaveLength(1);
});

it.each([0, 1])(
  'rejects merged-cell amplification in worksheet %i before invoking ExcelJS',
  async (index) => {
    const load = vi
      .spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load')
      .mockRejectedValue(new Error('PARSER_REACHED'));
    const sheets = ['<dimension ref="A1:F2"/>', '<dimension ref="A1:F2"/>'];
    sheets[index] += '<mergeCells count="1"><mergeCell ref="A1:XFD1048576"/></mergeCells>';
    await expect(readWorkbookMatrix(workbookXml(sheets))).rejects.toThrow(
      'IMPORT_FILE_CONTENT_INVALID',
    );
    expect(load).not.toHaveBeenCalled();
  },
);

it.each(['A1:F10923', 'A1:I2', 'A1:XFD1048576'])(
  'rejects an oversized ignored-sheet dimension %s before invoking ExcelJS',
  async (ref) => {
    const load = vi
      .spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load')
      .mockRejectedValue(new Error('PARSER_REACHED'));
    await expect(
      readWorkbookMatrix(workbookXml(['<dimension ref="A1:F2"/>', `<dimension ref="${ref}"/>`])),
    ).rejects.toThrow('IMPORT_FILE_CONTENT_INVALID');
    expect(load).not.toHaveBeenCalled();
  },
);

it('rejects more than four worksheets before invoking ExcelJS', async () => {
  const load = vi
    .spyOn(Object.getPrototypeOf(new ExcelJS.Workbook().xlsx), 'load')
    .mockRejectedValue(new Error('PARSER_REACHED'));
  await expect(
    readWorkbookMatrix(workbookXml(Array(5).fill('<dimension ref="A1:F2"/>'))),
  ).rejects.toThrow('IMPORT_FILE_CONTENT_INVALID');
  expect(load).not.toHaveBeenCalled();
});
