import {
  performerNetWeights as weighPerformers,
  suggestTipSplit as splitTip,
  type TipSuggestion,
  type TipWeight,
  type TipWeightLine,
} from '@pospay/domain';
import { SessionError } from './session-error.ts';

export type { TipSuggestion, TipWeight, TipWeightLine };

/**
 * يحوّل رفض النواة المشتركة إلى رفض الطلبات نفسه.
 * النواة ترمي RangeError لأنها لا تعرف SessionError، وبقية الطلبات ما زالت تنتظر VALIDATION_FAILED.
 *
 * @param run الحساب الصافي في النواة
 * @returns ناتج الحساب إن مرّ عقد الحصص والمبلغ
 */
function guard<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof RangeError) throw new SessionError('VALIDATION_FAILED');
    throw error;
  }
}

/**
 * يجمع وزن كل موظفة من صافي البنود الفعّالة فقط.
 * البند الملغي لا يدخل، والبند الفعّال خارج عقد الحصص يُرفض حتى لا يختلف الوزن عن نصيب العمولة.
 *
 * @param lines بنود الزيارة بحالتها وصافيها وحصص المنفّذات
 * @returns الأوزان بالفلس مرتبة بهوية الموظفة
 */
export function performerNetWeights(lines: readonly TipWeightLine[]): TipWeight[] {
  return guard(() => weighPerformers(lines));
}

/**
 * يقترح تقسيم البقشيش على أوزان صافي الزيارة بحيث يساوي المجموع البقشيش بالظبط.
 * الحساب في النواة المشتركة حتى تعرضه شاشة الاستقبال من غير نسخة ثانية، والرفض يبقى VALIDATION_FAILED.
 *
 * @param tip البقشيش المطلوب تقسيمه بالفلس
 * @param weights أوزان الموظفات من صافي الزيارة
 * @returns مبالغ الاقتراح بالفلس مرتبة بهوية الموظفة
 */
export function suggestTipSplit(tip: bigint, weights: readonly TipWeight[]): TipSuggestion[] {
  return guard(() => splitTip(tip, weights));
}
