import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';

import {
  buildCommissionStatementWorkbook,
  type CommissionStatementLabels,
  type CommissionStatementWorkbookInput,
} from '../excel/commission-statement.ts';
import type { CommissionStatementWorkbookRow } from '../excel/commission-statement-rows.ts';

const EN: CommissionStatementLabels = {
  summarySheet: 'Summary',
  detailSheet: 'Details',
  employeeNumber: 'Employee number',
  employeeName: 'Employee name',
  commission: 'Commission',
  salesCommission: 'Sales commission',
  correctionsReceived: 'Corrections received',
  cardTips: 'Card tips',
  cashTips: 'Cash tips (informational)',
  netPayable: 'Net payable',
  paidCash: 'Paid cash',
  entryKind: 'Entry type',
  businessDate: 'Business date',
  serviceName: 'Service',
  customerName: 'Customer name',
  sourcePeriod: 'Source month',
  previousAmount: 'Previous amount',
  newAmount: 'New amount',
  amount: 'Amount',
  kinds: {
    COMMISSION: 'Commission',
    SALE: 'Package sale commission',
    TIP_CARD: 'Card tip',
    TIP_CASH: 'Cash tip',
    CORRECTION: 'Correction',
    CORRECTION_TIP_CARD: 'Card-tip correction',
    CORRECTION_TIP_CASH: 'Cash-tip correction',
    CARRY_COMMISSION: 'Commission carry',
    CARRY_TIP_CARD: 'Card-tip carry',
    EMPLOYEE: 'Employee',
  },
};

const AR: CommissionStatementLabels = {
  ...EN,
  summarySheet: 'الملخص',
  detailSheet: 'التفاصيل',
  employeeNumber: 'الرقم الوظيفي',
  employeeName: 'اسم الموظفة',
  commission: 'العمولة',
  salesCommission: 'عمولة البيع',
  correctionsReceived: 'التصحيحات المستلمة',
  cardTips: 'بقشيش كارت',
  cashTips: 'بقشيش كاش (للعلم)',
  netPayable: 'الصافي اللي يتصرف',
  paidCash: 'اتصرف كاش',
  entryKind: 'نوع البند',
  businessDate: 'تاريخ العمل',
  serviceName: 'الخدمة',
  customerName: 'اسم العميلة',
  sourcePeriod: 'الشهر الأصلي',
  previousAmount: 'كان كام',
  newAmount: 'بقى كام',
  amount: 'المبلغ',
  kinds: { ...EN.kinds, COMMISSION: 'عمولة', CORRECTION: 'تصحيح' },
};

function row(overrides: Partial<CommissionStatementWorkbookRow>): CommissionStatementWorkbookRow {
  return {
    employeeId: 'employee-1',
    employeeNumber: 7,
    employeeNameAr: 'سارة',
    employeeNameEn: 'Sara',
    kind: 'EMPLOYEE',
    amount: 0n,
    previousAmount: null,
    newAmount: null,
    sourcePeriod: null,
    businessDate: null,
    serviceNameAr: null,
    serviceNameEn: null,
    customerName: null,
    ...overrides,
  };
}

function frozenRows(): CommissionStatementWorkbookRow[] {
  const service = {
    businessDate: '2026-10-10',
    serviceNameAr: 'قص شعر',
    serviceNameEn: 'Haircut',
    customerName: 'نورة محمد',
  };
  return [
    row({}),
    row({ kind: 'COMMISSION', amount: 41_003n, ...service }),
    row({ kind: 'SALE', amount: 10_000n }),
    row({
      kind: 'CORRECTION',
      amount: -2_000n,
      previousAmount: 12_000n,
      newAmount: 10_000n,
      sourcePeriod: '2026-09',
      ...service,
    }),
    row({ kind: 'TIP_CARD', amount: 6_000n }),
    row({ kind: 'TIP_CASH', amount: 4_000n }),
    row({
      kind: 'CORRECTION_TIP_CARD',
      amount: -1_000n,
      previousAmount: 7_000n,
      newAmount: 6_000n,
      sourcePeriod: '2026-09',
    }),
    row({
      kind: 'CORRECTION_TIP_CASH',
      amount: 500n,
      previousAmount: 3_500n,
      newAmount: 4_000n,
      sourcePeriod: '2026-09',
    }),
    row({ kind: 'CARRY_COMMISSION', amount: -3_000n, sourcePeriod: '2026-09' }),
    row({ kind: 'CARRY_TIP_CARD', amount: 2_000n, sourcePeriod: '2026-09' }),
  ];
}

function input(language: 'ar' | 'en'): CommissionStatementWorkbookInput {
  return { language, labels: language === 'ar' ? AR : EN, rows: frozenRows() };
}

async function open(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.slice().buffer);
  return workbook;
}

function cells(sheet: ExcelJS.Worksheet | undefined, row: number): ExcelJS.CellValue[] {
  return (sheet?.getRow(row).values as ExcelJS.CellValue[] | undefined)?.slice(1) ?? [];
}

it('writes Arabic headers and exact frozen amounts, names and payable totals', async () => {
  const workbook = await open(await buildCommissionStatementWorkbook(input('ar')));
  expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['الملخص', 'التفاصيل']);
  const summary = workbook.getWorksheet('الملخص');
  const detail = workbook.getWorksheet('التفاصيل');
  expect(summary?.views[0]?.rightToLeft).toBe(true);
  expect(cells(summary, 1)).toEqual([
    'الرقم الوظيفي',
    'اسم الموظفة',
    'العمولة',
    'عمولة البيع',
    'التصحيحات المستلمة',
    'بقشيش كارت',
    'بقشيش كاش (للعلم)',
    'الصافي اللي يتصرف',
  ]);
  expect(cells(summary, 2)).toEqual([
    7,
    'سارة',
    '41.003',
    '10.000',
    '-5.000',
    '7.000',
    '4.500',
    '53.003',
  ]);
  expect(summary?.getCell('C2').numFmt).toBe('@');
  expect(detail?.getCell('B2').value).toBe('سارة');
  expect(detail?.getCell('E2').value).toBe('قص شعر');
  expect(detail?.getCell('F2').value).toBe('نورة محمد');
  expect(detail?.getCell('J2').value).toBe('41.003');
  expect(detail?.getCell('J2').numFmt).toBe('@');
  expect(detail?.getCell('G4').value).toBe('2026-09');
  expect(detail?.getCell('H4').value).toBe('12.000');
  expect(detail?.getCell('I4').value).toBe('10.000');
  expect(detail?.getCell('J4').value).toBe('-2.000');
});

it('writes English headers and keeps the sheet left-to-right', async () => {
  const workbook = await open(await buildCommissionStatementWorkbook(input('en')));
  const summary = workbook.getWorksheet('Summary');
  expect(summary?.views[0]?.rightToLeft).toBe(false);
  expect(cells(summary, 1)).toEqual([
    'Employee number',
    'Employee name',
    'Commission',
    'Sales commission',
    'Corrections received',
    'Card tips',
    'Cash tips (informational)',
    'Net payable',
  ]);
  expect(summary?.getCell('B2').value).toBe('Sara');
  expect(workbook.getWorksheet('Details')?.getCell('E2').value).toBe('Haircut');
});

it('adds the rounded paid-cash column only when cash payment data is present', async () => {
  const cash = await open(
    await buildCommissionStatementWorkbook({
      ...input('ar'),
      rows: frozenRows().filter((row) => row.kind === 'EMPLOYEE' || row.kind === 'COMMISSION'),
      paidCash: [{ employeeId: 'employee-1', amount: 41_005n }],
    }),
  );
  const cashSummary = cash.getWorksheet('الملخص');
  expect(cashSummary?.getCell('I1').value).toBe('اتصرف كاش');
  expect(cashSummary?.getCell('I2').value).toBe('41.005');
  expect(cashSummary?.getCell('H2').value).toBe('41.003');

  const approved = await open(await buildCommissionStatementWorkbook(input('ar')));
  expect(approved.getWorksheet('الملخص')?.getCell('I1').value).toBeNull();
});

it('pays zero for negative sides without netting cash tips or the other side', async () => {
  const bytes = await buildCommissionStatementWorkbook({
    language: 'en',
    labels: EN,
    rows: [
      row({ kind: 'COMMISSION', amount: -25_000n }),
      row({ kind: 'TIP_CARD', amount: 6_000n }),
      row({ kind: 'TIP_CASH', amount: 4_000n }),
    ],
  });
  const summary = (await open(bytes)).getWorksheet('Summary');
  expect(cells(summary, 2)).toEqual([
    7,
    'Sara',
    '-25.000',
    '0.000',
    '0.000',
    '6.000',
    '4.000',
    '6.000',
  ]);
});
