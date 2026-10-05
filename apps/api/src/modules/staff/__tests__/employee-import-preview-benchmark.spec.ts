import ExcelJS from 'exceljs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import {
  employeeImportFixture,
  previewCommand,
  type EmployeeImportFixture,
} from './employee-import.fixture.ts';
import { buildEmployeeImportTemplate } from '../persistence/employee-import-template.ts';
import { guardXlsxZip } from '../../../shared/import/xlsx-zip-guard.ts';

let f: EmployeeImportFixture;
beforeAll(async () => {
  f = await employeeImportFixture();
});
afterAll(async () => {
  await f?.db.close();
  await f?.h.close();
});

it('measures a warm 500-row real template with maximum-length name/branch fields within the 5 MiB expansion cap', async () => {
  const branchName = 'B'.repeat(255);
  await f.h.owner`UPDATE branches SET name_en=${branchName} WHERE id=${f.branch}`;
  const workbook = new ExcelJS.Workbook();
  const template = await buildEmployeeImportTemplate([{ name_en: branchName, name_ar: null }]);
  await workbook.xlsx.load(
    Buffer.from(template) as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );
  const sheet = workbook.worksheets[0];
  if (sheet === undefined) throw new Error('Template missing');
  for (let index = 0; index < 500; index++)
    sheet.addRow([
      `${index}`.padEnd(255, 'N'),
      `${index}`.padEnd(255, 'م'),
      'general_manager',
      '2026-01-01',
      '2099-12-31',
      branchName,
    ]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  expect(() => guardXlsxZip(bytes)).not.toThrow();
  const end = bytes.length - 22;
  let at = bytes.readUInt32LE(end + 16);
  let expanded = 0;
  while (at < end) {
    expanded += bytes.readUInt32LE(at + 24);
    at +=
      46 + bytes.readUInt16LE(at + 28) + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  expect(expanded).toBeLessThanOrEqual(5 * 1024 * 1024);
  const file = await f.upload(bytes);
  await f.preview.execute(previewCommand(f, file));
  const times: number[] = [];
  for (let run = 0; run < 5; run++) {
    const start = performance.now();
    const preview = await f.preview.execute(previewCommand(f, file));
    times.push(performance.now() - start);
    expect(preview).toMatchObject({ row_count: 500, error_count: 0 });
  }
  const median = times.toSorted((a, b) => a - b)[2] as number;
  console.info('EMPLOYEE_IMPORT_500_PREVIEW', {
    compressed_bytes: bytes.length,
    expanded_bytes: expanded,
    warm_ms: times.map((ms) => Number(ms.toFixed(2))),
    median_ms: Number(median.toFixed(2)),
  });
  expect(await f.h.owner`SELECT id FROM employees WHERE company_id=${f.company}`).toHaveLength(0);
});
