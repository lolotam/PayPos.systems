import type { Tx } from '@pospay/db';

/**
 * مزودو قراءات قائمة التجاوزات: الصلاحية والميزة وتوقيت النشاط ووجود الموظفة.
 * جذر التطبيق بيربطهم، والمهايئ هنا بياخد منهم بس — من غير أي استيراد لوحدة تانية.
 */
export interface CommissionServiceOverrideListReadProviders {
  readonly access: (
    tx: Tx,
    companyId: string,
    userId: string,
    businessId: string,
  ) => Promise<'FORBIDDEN' | 'FEATURE_DISABLED' | null>;
  readonly timeZone: (tx: Tx, companyId: string, businessId: string) => Promise<string | null>;
  readonly employeeExists: (
    tx: Tx,
    companyId: string,
    businessId: string,
    employeeId: string,
  ) => Promise<boolean>;
}

/**
 * يربط قراءات المزودين بنفس معاملة القارئ، عشان القراءة كلها في transaction واحدة.
 *
 * @param providers دوال المزودين المربوطة في جذر التطبيق
 * @returns مصنع بياخد المعاملة ويرجّع القراءات عليها
 */
export function createCommissionServiceOverrideListReaders(
  providers: CommissionServiceOverrideListReadProviders,
) {
  return (tx: Tx) => ({
    access: (companyId: string, userId: string, businessId: string) =>
      providers.access(tx, companyId, userId, businessId),
    timeZone: (companyId: string, businessId: string) =>
      providers.timeZone(tx, companyId, businessId),
    employeeExists: (companyId: string, businessId: string, employeeId: string) =>
      providers.employeeExists(tx, companyId, businessId, employeeId),
  });
}
