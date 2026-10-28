/**
 * Kind of the commission statement Excel export. It is a bytes kind, so the API admits it
 * without Chromium and the worker hands back the workbook it built.
 */
export const COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND = 'commission-statement-xlsx';

/**
 * The scope an export request may carry: the whole business, or the branches the reader is
 * allowed to see. The scope decides whether the request carries branch and employee arrays.
 */
export const commissionStatementExportScopes = ['BUSINESS', 'BRANCHES'] as const;

export type CommissionStatementExportScope = (typeof commissionStatementExportScopes)[number];
