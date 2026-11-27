import type { TeamAlertContact } from '@pospay/domain';

/** مصدر جهات الاتصال على معاملة المُرسِل؛ غيابه مقبول لقاعدة جرس وحده فقط. */
export interface TeamAlertContactSource {
  /**
   * جهات اتصال المستلمين من دالة القراءة المحدودة على المعاملة نفسها (ADR-0003 §6a).
   *
   * @param userIds المستلمين
   * @param at لحظة نافذة العضوية
   * @returns جهة اتصال لكل مستخدم عنده وجهة صالحة
   */
  contacts?(
    userIds: readonly string[],
    at: Date,
  ): Promise<ReadonlyMap<string, TeamAlertContact>>;
}
