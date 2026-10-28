/**
 * نوع تصدير كشف العمولات بصيغة Excel. النوع ده bytes، عشان كده الـ API بيقبله من غير Chromium،
 * والـ worker بيرجّع الـ workbook اللي جهّزه.
 */
export const COMMISSION_STATEMENT_EXPORT_DOCUMENT_KIND = 'commission-statement-xlsx';

/**
 * نطاق طلب التصدير: البيزنس كله (`BUSINESS`)، أو الفروع اللي القارئ مسموح له يشوفها
 * (`BRANCHES`). النطاق بيحدد إذا كان الطلب هيشيل مصفوفتَي الفروع والموظفين ولا لأ.
 */
export const commissionStatementExportScopes = ['BUSINESS', 'BRANCHES'] as const;

export type CommissionStatementExportScope = (typeof commissionStatementExportScopes)[number];
