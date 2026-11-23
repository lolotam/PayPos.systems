import type { CommissionPeriodRepairSaved as Payload } from '@pospay/contracts';

/**
 * يصدر مرة واحدة في نفس معاملة حفظ إصلاح شهر مقفول، بعد إدخال نسخة الإصلاح والتصحيحات وتحديث التصحيح الموقوف
 * والتدقيق، ويحمل المعرفات ونتيجة التصحيح الموقوف فقط. بيصدر حتى لو فضل التصحيح NO_SALARY (CM-52b)،
 * ولا يصدر عند رفض الإصلاح أو إعادة إرسال نفس المفتاح.
 */
export type CommissionPeriodRepairSaved = Payload;
