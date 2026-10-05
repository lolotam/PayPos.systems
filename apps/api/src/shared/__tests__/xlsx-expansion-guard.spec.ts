import { expect, it } from 'vitest';
import { guardWorkbookXml, guardWorksheetXml } from '../import/xlsx-xml-guard.ts';
import { guardXlsxZip } from '../import/xlsx-zip-guard.ts';
import { archiveParts as zipParts } from './xlsx-zip.fixture.ts';

const bounds = { maxRows: 502, maxColumns: 8, maxWorksheets: 4 };
const worksheet = (xml: string) =>
  guardWorksheetXml(Buffer.from(`<worksheet>${xml}</worksheet>`), bounds);
const workbook = (xml: string) =>
  guardWorkbookXml(Buffer.from(`<workbook>${xml}</workbook>`), bounds);
const archiveParts = (parts: { name: string; content: string }[]) =>
  zipParts(
    parts.map((part) => {
      const root = part.name.endsWith('.rels')
        ? 'Relationships'
        : part.name.endsWith('workbook.xml')
          ? 'workbook'
          : 'worksheet';
      return { ...part, content: `<${root}>${part.content}</${root}>` };
    }),
  );

it.each(['0', '9', '1048576', '1.5', '1e9', '&#57;'])(
  'rejects column allocation min/max %s',
  (value) => {
    expect(() => worksheet(`<cols><col min="${value}" max="${value}"/></cols>`)).toThrow(
      'IMPORT_FILE_CONTENT_INVALID',
    );
  },
);

it.each(['<!--c-->', '<![CDATA[x]]>', '<x/>'])(
  'rejects markup inside the complete defined-name text %s',
  (markup) => {
    expect(() =>
      workbook(`<definedName name="x">${markup}employees!$A$1:$H$1048576</definedName>`),
    ).toThrow('IMPORT_FILE_CONTENT_INVALID');
  },
);

it('accepts entity-decoded defined-name attributes', () => {
  expect(() => workbook('<definedName name="&#120;">employees!$A$1</definedName>')).not.toThrow();
});

it('charges duplicate validation ranges against one aggregate budget', () => {
  const validation = `<dataValidation sqref="${Array(16).fill('A1:H502').join(' ')}"/>`;
  expect(() => worksheet(validation.repeat(10_000))).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it('stops a single large validation list at the aggregate budget', () => {
  expect(() => worksheet(`<dataValidation sqref="${'A1 '.repeat(1_000_000)}"/>`)).toThrow(
    'IMPORT_FILE_CONTENT_INVALID',
  );
});

it('charges column declarations including gaps and repeated maxima', () => {
  expect(() => worksheet('<col min="8" max="8"/>'.repeat(8193))).toThrow(
    'IMPORT_FILE_CONTENT_INVALID',
  );
});

it('accepts many small ranges and names within the aggregate budget', () => {
  expect(() => worksheet(`<dataValidation sqref="${'A1 '.repeat(100).trim()}"/>`)).not.toThrow();
  expect(() =>
    workbook('<definedName name="x">employees!$A$1</definedName>'.repeat(100)),
  ).not.toThrow();
});

it('leaves headroom for full data and reference grids with normal saved metadata', () => {
  const bytes = archiveParts([
    {
      name: 'xl/workbook.xml',
      content:
        '<sheet name="employees" r:id="rId1"/><sheet name="reference" r:id="rId2"/><definedName name="data">employees!A1:H502</definedName>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/>',
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content:
        '<dimension ref="A1:H502"/><col min="1" max="8"/><mergeCell ref="A1:B1"/><dataValidation sqref="A2:F502"/>',
    },
    { name: 'xl/worksheets/sheet2.xml', content: '<dimension ref="A1:C2001"/>' },
  ]);
  expect(() => guardXlsxZip(bytes, bounds)).not.toThrow();
});

it('resolves the data sheet through relationships rather than ZIP order or sheet number', () => {
  const metadata = [
    {
      name: 'xl/workbook.xml',
      content: '<sheet name="employees" r:id="data"/><sheet name="reference" r:id="ref"/>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: '<Relationship Id="data" Target="worksheets/sheet2.xml"/>',
    },
  ];
  expect(() =>
    guardXlsxZip(
      archiveParts([
        { name: 'xl/worksheets/sheet1.xml', content: '<dimension ref="A1:C2001"/>' },
        ...metadata,
        { name: 'xl/worksheets/sheet2.xml', content: '<dimension ref="A1:H503"/>' },
      ]),
      bounds,
    ),
  ).toThrow('IMPORT_ROW_LIMIT_EXCEEDED');
  expect(() =>
    guardXlsxZip(
      archiveParts([
        { name: 'xl/worksheets/sheet1.xml', content: '<dimension ref="A1:C2001"/>' },
        ...metadata,
        { name: 'xl/worksheets/sheet2.xml', content: '<dimension ref="A1:H502"/>' },
      ]),
      bounds,
    ),
  ).not.toThrow();
});

it('shares expansion accounting across columns, merges, validations, names and worksheet parts', () => {
  const bytes = archiveParts([
    {
      name: 'xl/workbook.xml',
      content: `<definedName name="x">${Array(8).fill('employees!A1:H502').join(',')}</definedName>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      content: '<cols><col min="8" max="8"/></cols><mergeCell ref="A1:H502"/>'.repeat(4),
    },
    {
      name: 'xl/worksheets/sheet2.xml',
      content: '<dataValidation sqref="A1:H502 A1:H502 A1:H502 A1:H502 A1:H502"/>',
    },
  ]);
  expect(() => guardXlsxZip(bytes, bounds)).toThrow('IMPORT_FILE_CONTENT_INVALID');
});

it('accepts bounded Excel print titles and print area as metadata', () => {
  expect(() =>
    workbook(
      '<definedName name="_xlnm.Print_Titles">employees!$1:$1,employees!$A:$B</definedName><definedName name="_xlnm.Print_Area">employees!$A$1:$H$502</definedName>',
    ),
  ).not.toThrow();
});

it('does not charge built-in print metadata as cell expansions', () => {
  expect(() =>
    workbook(
      '<definedName name="_xlnm.Print_Area">employees!$A$1:$H$502</definedName>'.repeat(100),
    ),
  ).not.toThrow();
});

it.each([
  ['_xlnm.Print_Titles', 'employees!$1:$503'],
  ['_xlnm.Print_Titles', 'employees!$A:$I'],
  ['_xlnm.Print_Area', 'employees!$A$1:$H$503'],
  ['_xlnm.Print_Area', 'employees!$A:$B'],
])('rejects invalid print metadata %s %s', (name, formula) => {
  expect(() => workbook(`<definedName name="${name}">${formula}</definedName>`)).toThrow(
    'IMPORT_FILE_CONTENT_INVALID',
  );
});
