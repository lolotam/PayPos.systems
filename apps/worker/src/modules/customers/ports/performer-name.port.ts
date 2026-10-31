import type { Tx } from '@pospay/db';

/** اسم المنفذ بلغتي العرض؛ null لما لا اسم آمن للعرض في اللغة (ADR-0037 §4). */
export interface PerformerDisplayName {
  readonly employeeId: string;
  readonly nameAr: string | null;
  readonly nameEn: string | null;
}

/** قراءة أسماء منفذي الخدمة من staff، لأن customers لا يستورد جداوله (ADR-0010). */
export interface PerformerNamePort {
  /**
   * يرجع الاسم الأول الآمن للعرض لكل موظف مطلوب، وباللغتين لأن رسالة التقييم بلغة العميل.
   *
   * @param tx معاملة المستأجر
   * @param companyId الشركة المالكة للموظفين
   * @param employeeIds معرّفات المنفذين المطلوبين
   * @returns أسماء المنفذين؛ الموظف بلا اسم آمن يظهر باسمين فارغين
   */
  firstNames(
    tx: Tx,
    companyId: string,
    employeeIds: readonly string[],
  ): Promise<readonly PerformerDisplayName[]>;
}
