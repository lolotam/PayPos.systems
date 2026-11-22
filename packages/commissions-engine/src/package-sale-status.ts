import type { CommissionProjectionStatus } from './period-input-types.ts';

/**
 * يحوّل حالة بيع الباقة المحفوظة في إسقاط العمولة إلى حالة المحرك.
 * الحالة المحفوظة هي قيمة الحدث كما هي ('SOLD' اليوم) لأنها عقد مستقبلي لإلغاء
 * البيع، فالمحرك ما يعرفش إلا 'ACTIVE' و 'CANCELLED'. التحويل صريح ومقصود عشان
 * القارئ ما يبدّلش حالة مخزّنة في مكان تاني، وبيبقى في مكان واحد يتشاركه الـ worker
 * والـ API بدل ما يتكرر التحويل في كل قارئ.
 *
 * @param storedStatus الحالة كما حفظها الإسقاط، وهي قيمة الحدث الخام
 * @returns 'ACTIVE' لبيع قائم، و 'CANCELLED' لأي حالة أخرى تخرج من التسعير
 */
export function projectPackageSaleStatus(storedStatus: string): CommissionProjectionStatus {
  return storedStatus === 'SOLD' ? 'ACTIVE' : 'CANCELLED';
}
