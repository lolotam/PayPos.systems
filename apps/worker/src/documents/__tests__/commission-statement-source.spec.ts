import { DOCUMENT_XLSX_MIME_TYPE } from '@pospay/contracts';
import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';

import type { CommissionStatementExportData } from '../../modules/commissions/index.ts';
import { createCommissionStatementSource } from '../sources/commission-statement.source.ts';

const COMPANY = '01920000-0000-7000-8000-0000000000a0';
const RENDER = '01920000-0000-7000-8000-0000000000e1';

function data(language: 'ar' | 'en'): CommissionStatementExportData {
  return {
    request: {
      statementId: 'statement-1',
      businessId: 'business-1',
      period: '2026-10',
      statementStatus: 'APPROVED',
      language,
      scope: 'BUSINESS',
      branchIds: null,
      employeeIds: null,
    },
    rows: [
      {
        employeeId: 'employee-1',
        employeeNumber: 7,
        employeeNameAr: 'سارة',
        employeeNameEn: 'Sara',
        sourceRef: 'line:1',
        kind: 'COMMISSION',
        amount: 41_003n,
        previousAmount: null,
        newAmount: null,
        sourcePeriod: null,
        sourceBranchId: 'branch-1',
        attachedBranchIds: ['branch-1'],
        businessDate: '2026-10-10',
        serviceNameAr: 'قص شعر',
        serviceNameEn: 'Haircut',
        customerName: 'نورة محمد',
      },
    ],
    paidCash: null,
  };
}

it('builds real xlsx bytes with the saved language and never needs HTML', async () => {
  const source = createCommissionStatementSource({ readExport: async () => data('ar') });
  expect(source.output).toBe('bytes');
  expect(source.mimeType).toBe(DOCUMENT_XLSX_MIME_TYPE);
  const bytes = await source.load(COMPANY, RENDER);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  const summary = workbook.getWorksheet('الملخص');
  expect(summary?.getCell('C2').value).toBe('41.003');
  expect(summary?.views[0]?.rightToLeft).toBe(true);
  expect(workbook.getWorksheet('التفاصيل')?.getCell('F2').value).toBe('نورة محمد');
});

it('uses English labels and frozen English names for an English request', async () => {
  const source = createCommissionStatementSource({ readExport: async () => data('en') });
  const bytes = await source.load(COMPANY, RENDER);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  const summary = workbook.getWorksheet('Summary');
  expect(summary?.getCell('B2').value).toBe('Sara');
  expect(summary?.views[0]?.rightToLeft).toBe(false);
  expect(workbook.getWorksheet('Details')?.getCell('E2').value).toBe('Haircut');
});
