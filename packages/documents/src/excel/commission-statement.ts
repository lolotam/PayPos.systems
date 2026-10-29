import { moneyToString, type Money } from '@pospay/domain';
import ExcelJS from 'exceljs';

import {
  summarizeCommissionStatement,
  type CommissionStatementEmployeeTotal,
  type CommissionStatementRowKind,
  type CommissionStatementWorkbookRow,
} from './commission-statement-rows.ts';

export type CommissionStatementLanguage = 'ar' | 'en';

export interface CommissionStatementLabels {
  readonly summarySheet: string;
  readonly detailSheet: string;
  readonly employeeNumber: string;
  readonly employeeName: string;
  readonly commission: string;
  readonly salesCommission: string;
  readonly correctionsReceived: string;
  readonly cardTips: string;
  readonly cashTips: string;
  readonly netPayable: string;
  readonly paidCash: string;
  readonly entryKind: string;
  readonly businessDate: string;
  readonly serviceName: string;
  readonly customerName: string;
  readonly sourcePeriod: string;
  readonly previousAmount: string;
  readonly newAmount: string;
  readonly amount: string;
  readonly kinds: Readonly<Record<CommissionStatementRowKind, string>>;
}

export interface CommissionStatementPaidCash {
  readonly employeeId: string;
  readonly amount: Money;
}

export interface CommissionStatementWorkbookInput {
  readonly language: CommissionStatementLanguage;
  readonly labels: CommissionStatementLabels;
  readonly rows: readonly CommissionStatementWorkbookRow[];
  readonly paidCash?: readonly CommissionStatementPaidCash[] | null;
}

function localized(ar: string | null, en: string | null, language: CommissionStatementLanguage) {
  return (language === 'ar' ? ar : en) ?? en ?? ar ?? '';
}

function moneyCell(value: Money | null): string {
  return value === null ? '' : moneyToString(value);
}

function header(sheet: ExcelJS.Worksheet, labels: readonly string[]): void {
  const row = sheet.addRow([...labels]);
  row.font = { bold: true };
}

function summaryHeaders(input: CommissionStatementWorkbookInput): string[] {
  const labels = input.labels;
  return [
    labels.employeeNumber,
    labels.employeeName,
    labels.commission,
    labels.salesCommission,
    labels.correctionsReceived,
    labels.cardTips,
    labels.cashTips,
    labels.netPayable,
    ...(input.paidCash == null ? [] : [labels.paidCash]),
  ];
}

function summaryRow(
  employee: CommissionStatementEmployeeTotal,
  input: CommissionStatementWorkbookInput,
): (string | number)[] {
  const rounded = input.paidCash?.find((payment) => payment.employeeId === employee.employeeId);
  return [
    employee.employeeNumber,
    localized(employee.employeeNameAr, employee.employeeNameEn, input.language),
    moneyCell(employee.commission),
    moneyCell(employee.salesCommission),
    moneyCell(employee.corrections),
    moneyCell(employee.cardTips),
    moneyCell(employee.cashTips),
    moneyCell(employee.netPayable),
    ...(input.paidCash == null ? [] : [moneyCell(rounded?.amount ?? null)]),
  ];
}

function addSummarySheet(workbook: ExcelJS.Workbook, input: CommissionStatementWorkbookInput): void {
  const sheet = workbook.addWorksheet(input.labels.summarySheet, {
    views: [{ rightToLeft: input.language === 'ar' }],
  });
  header(sheet, summaryHeaders(input));
  for (const employee of summarizeCommissionStatement(input.rows)) {
    sheet.addRow(summaryRow(employee, input));
  }
  for (let column = 3; column <= sheet.columnCount; column += 1) {
    sheet.getColumn(column).numFmt = '@';
  }
}

function detailHeaders(labels: CommissionStatementLabels): string[] {
  return [
    labels.employeeNumber,
    labels.employeeName,
    labels.entryKind,
    labels.businessDate,
    labels.serviceName,
    labels.customerName,
    labels.sourcePeriod,
    labels.previousAmount,
    labels.newAmount,
    labels.amount,
  ];
}

function detailRow(
  row: CommissionStatementWorkbookRow,
  input: CommissionStatementWorkbookInput,
): (string | number)[] {
  return [
    row.employeeNumber,
    localized(row.employeeNameAr, row.employeeNameEn, input.language),
    input.labels.kinds[row.kind],
    row.businessDate ?? '',
    localized(row.serviceNameAr, row.serviceNameEn, input.language),
    row.customerName ?? '',
    row.sourcePeriod ?? '',
    moneyCell(row.previousAmount),
    moneyCell(row.newAmount),
    moneyCell(row.amount),
  ];
}

function addDetailSheet(workbook: ExcelJS.Workbook, input: CommissionStatementWorkbookInput): void {
  const sheet = workbook.addWorksheet(input.labels.detailSheet, {
    views: [{ rightToLeft: input.language === 'ar' }],
  });
  header(sheet, detailHeaders(input.labels));
  for (const row of input.rows) {
    if (row.kind !== 'EMPLOYEE') sheet.addRow(detailRow(row, input));
  }
  for (let column = 8; column <= 10; column += 1) {
    sheet.getColumn(column).numFmt = '@';
  }
}

/**
 * يبني ملف Excel من الصفوف المجمّدة بعد ترشيحها؛ المبالغ خلايا نصية بثلاث خانات
 * عشان قيمة الكشف ما تتغيّرش بتحويلها لرقم عشري، والعناوين والأسماء بلغة التنزيل.
 *
 * @param input اللغة والعناوين والصفوف المجمّدة والمبالغ المتقرّبة عند الصرف كاش
 * @returns بايتات ملف xlsx
 */
export async function buildCommissionStatementWorkbook(
  input: CommissionStatementWorkbookInput,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  addSummarySheet(workbook, input);
  addDetailSheet(workbook, input);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}
