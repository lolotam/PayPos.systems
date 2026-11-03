import type {
  PrivateViewOpenInput,
  PrivateViewOpenResult,
  PrivateViewPinInput,
  PrivateViewProof,
  PrivateViewScope,
} from '@pospay/auth';

/**
 * السلطة اللي بتثبّت PIN الموظف وبتفتح نافذة العرض الخاص.
 * الواجهة مقصودة أصغر من واجهة الاعتماد: الفتح بيحتاج الدليل اللي بتعمله المقارنة نفسها.
 */
export interface PrivateViewAuthority {
  /**
   * يقارن PIN الموظف وبيصكّ دليلاً أحادي الاستعمال؛ الدليل ده هو اللي بيفتح النافذة.
   *
   * @param input الـ PIN والـ hash المخزّن ونطاق الجلسة
   */
  provePin(input: PrivateViewPinInput): Promise<PrivateViewProof | null>;
  /**
   * يفتح النافذة على الدليل والنطاق وجهاز الجلسة؛ الرفض بيفرق بين دليل منتهي وجلسة مش سارية.
   *
   * @param input الدليل والنطاق وجهاز الجلسة
   */
  open(input: PrivateViewOpenInput): Promise<PrivateViewOpenResult>;
  /**
   * يقفل النافذة ويرجع هل كانت مفتوحة؛ المستهلك يحتاجه لمنع بقاء نافذة بلا سطر تدقيق لو فشل commit.
   *
   * @param scope نطاق جلسة الموظف وجهازها
   * @param windowId معرّف النافذة المطلوب قفلها
   * @returns true لو النافذة اتقفلت، وfalse لو لم تكن مفتوحة
   */
  close(scope: PrivateViewScope, windowId: string): Promise<boolean>;
}
