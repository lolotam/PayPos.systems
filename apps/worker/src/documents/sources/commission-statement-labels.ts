import type { CommissionStatementLabels } from '@pospay/documents';
import { t, type Locale, type MessageKey } from '@pospay/i18n';

function label(language: Locale, name: string): string {
  return t(language, `commissionStatement.${name}` as MessageKey);
}

/**
 * عناوين ملف كشف العمولة بلغة التنزيل. الـ builder في packages/documents بيفضل
 * من غير اعتماد على i18n، زي قالب بيان الحضور، والكتالوج هو مصدر النص الوحيد.
 *
 * @param language لغة التنزيل المختارة
 * @returns عناوين الورقتين وكل أنواع الصفوف
 */
export function commissionStatementLabels(language: Locale): CommissionStatementLabels {
  return {
    summarySheet: label(language, 'summarySheet'),
    detailSheet: label(language, 'detailSheet'),
    employeeNumber: label(language, 'employeeNumber'),
    employeeName: label(language, 'employeeName'),
    commission: label(language, 'commission'),
    salesCommission: label(language, 'salesCommission'),
    correctionsReceived: label(language, 'correctionsReceived'),
    cardTips: label(language, 'cardTips'),
    cashTips: label(language, 'cashTips'),
    netPayable: label(language, 'netPayable'),
    paidCash: label(language, 'paidCash'),
    entryKind: label(language, 'entryKind'),
    businessDate: label(language, 'businessDate'),
    serviceName: label(language, 'serviceName'),
    customerName: label(language, 'customerName'),
    sourcePeriod: label(language, 'sourcePeriod'),
    previousAmount: label(language, 'previousAmount'),
    newAmount: label(language, 'newAmount'),
    amount: label(language, 'amount'),
    kinds: {
      COMMISSION: label(language, 'kindCommission'),
      SALE: label(language, 'kindSale'),
      TIP_CARD: label(language, 'kindTipCard'),
      TIP_CASH: label(language, 'kindTipCash'),
      CORRECTION: label(language, 'kindCorrection'),
      CORRECTION_TIP_CARD: label(language, 'kindCorrectionTipCard'),
      CORRECTION_TIP_CASH: label(language, 'kindCorrectionTipCash'),
      CARRY_COMMISSION: label(language, 'kindCarryCommission'),
      CARRY_TIP_CARD: label(language, 'kindCarryTipCard'),
      EMPLOYEE: '',
    },
  };
}
