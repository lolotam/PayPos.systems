import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { readWorkbookSheet } from '../../../shared/import/xlsx-sheet-reader.ts';import { ServiceImportError } from '../domain/errors.ts';
import { SERVICE_IMPORT_MAX_BYTES, SERVICE_IMPORT_MAX_COLUMNS, SERVICE_IMPORT_MAX_DATA_ROWS } from '../domain/service-import.ts';
import {
  SERVICE_IMPORT_TEMPLATE_HEADERS,
  SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_POSITIONS,
  SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS,
  serviceImportTemplateCapacity,
} from '../domain/service-import-template.ts';
import { createServiceImportTemplateBuilder } from '../persistence/service-import-template.ts';
import type { ServiceImportCategoryOption } from '../ports/service-import.port.ts';

// القالب نفسه يجب أن يجتاز القارئ المحمي نفسه، وسعة المرجع تُرفض قبل أي بناء (P-3).

const BOUNDS = {
  maxBytes: SERVICE_IMPORT_MAX_BYTES,
  maxDataRows: SERVICE_IMPORT_MAX_DATA_ROWS,
  maxColumns: SERVICE_IMPORT_MAX_COLUMNS,
  maxWorksheets: 2,
};

const option = (name: string): ServiceImportCategoryOption => ({
  id: `00000000-0000-7000-8000-${name.padStart(12, '0')}`.slice(0, 36),
  name_en: name,
  name_ar: null,
});

describe('template reference capacity (P-3)', () => {
  it.each([
    [0, true],
    [1_000, true],
    [6_546, true],
    [6_547, false],
    [8_000, false],
  ])('judges %i categories as within limits: %s', (categories, ok) => {
    expect(serviceImportTemplateCapacity(categories).ok).toBe(ok);
  });

  it('documents the P-3 ceilings exactly', () => {
    expect(SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_ROWS).toBe(6_552);
    expect(SERVICE_IMPORT_TEMPLATE_MAX_REFERENCE_POSITIONS).toBe(35_416);
    expect(SERVICE_IMPORT_TEMPLATE_HEADERS).toHaveLength(8);
  });
});

describe('template workbook round-trip', () => {
  it('writes the eight authoritative headers with notes and one reference sheet', async () => {
    const build = createServiceImportTemplateBuilder();
    const base64 = await build.build([option('Hair'), option('Nails')]);
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    // القارئ المحمي يقرأ ورقة البيانات الأولى فقط؛ ورقة المرجع تُفحص على المصنف نفسه بعد جولة الحارس.
    const roundTrip = await readWorkbookSheet(bytes, BOUNDS);
    const headers = roundTrip.matrix[0]?.map((cell) => String(cell ?? '').trim());
    expect(headers).toEqual([...SERVICE_IMPORT_TEMPLATE_HEADERS]);
    expect(roundTrip.formats).toHaveLength(roundTrip.matrix.length);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
    const referenceSheet = book.getWorksheet('reference');
    expect(referenceSheet).toBeDefined();
    const rows: string[][] = [];
    referenceSheet?.eachRow((row) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => values.push(String(cell.value ?? '')));
      rows.push(values);
    });
    // الصف الأول عناوين المرجع، وأربع قواعد العمولة بعده، ثم سطر كتابات الاحتساب، وكل تصنيف صف.
    expect(rows[1]).toContain('FOLLOW_PLAN');
    expect(rows[2]).toContain('ZERO');
    expect(rows[3]).toContain('PCT');
    expect(rows[4]).toContain('FIXED');
    const texts = rows.flat().join('\n');
    expect(texts).toContain('true / false');
    expect(texts).toContain('Hair');
    expect(texts).toContain('Nails');
  });

  it('refuses the download when the open categories exceed the reference ceiling', async () => {
    // سقف حارس القارئ لورقة المرجع هو floor(65,536/10) = 6,553 صفاً، فالمعاينة التي تتجاوزه تُرفض هنا أيضاً.
    const build = createServiceImportTemplateBuilder();
    const categories = Array.from({ length: 6_600 }, (_: unknown, index: number) =>
      option(`Category ${index}`),
    );
    await expect(build.build(categories)).rejects.toBeInstanceOf(ServiceImportError);
  });

  it('refuses before any build when the documented P-3 ceiling is exceeded', () => {
    // سقف P-3 الموثّق (6,552 صفاً) أصرم من سقف الحارس بصف واحد، والرفض قبل البناء هو المسار الموثّق:
    // حالة الاستخدام تفحص السعة قبل أي بناء، فلا يُكتب ولا يُولَّد أي مصنف لطلب فوق السقف.
    expect(serviceImportTemplateCapacity(6_546).ok).toBe(true);
    expect(serviceImportTemplateCapacity(6_547)).toEqual({ ok: false, reason: 'REFERENCE_ROWS' });
  });
});
