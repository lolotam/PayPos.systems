import {
  arabicDisplayName,
  DEFAULT_NAME_FALLBACK,
  englishDisplayName,
  type NameFallback,
} from './not-clocked-in.ts';

/** معامل قالب إشعار الموظفة بنفسها: ساعة بداية ورديتها واسم الفرع باللغتين. */
export interface SelfParameter {
  readonly name: 'shift_start' | 'branch_name_ar' | 'branch_name_en';
  readonly type: 'text';
  readonly value: string;
}

/** ساعة بداية الوردية بنظام 24 ساعة؛ أي نص تاني معناها إن الجدول ما فيهاش وقت صالح. */
const SHIFT_START_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * معاملات قالب إشعار الموظفة بنفسها: ساعة بداية ورديتها واسم الفرع باللغتين.
 * الاسم المرفوض (رابط أو هاتف أو رمز) بيرجع للإنجليزي السليم أو للاسم العام الآمن، والقالب ما بيقعش.
 * ساعة البداية بتفضل 24 ساعة من غير «م»، عشان المتلقي يشوفها على جهازه.
 *
 * @param branchNameAr اسم الفرع العربي أو null
 * @param branchNameEn اسم الفرع الإنجليزي
 * @param shiftStart بداية الوردية المحلية HH:MM
 * @param fallback الأسماء العامة من كتالوج اللغتين
 * @returns المعاملات بالترتيب، أو null إذا لم تكن الساعة HH:MM
 */
export function shiftNotClockedInSelfParameters(
  branchNameAr: string | null,
  branchNameEn: string,
  shiftStart: string,
  fallback: NameFallback = DEFAULT_NAME_FALLBACK,
): readonly SelfParameter[] | null {
  if (!SHIFT_START_TIME.test(shiftStart)) return null;
  return [
    named('shift_start', shiftStart),
    named('branch_name_ar', arabicDisplayName(branchNameAr, branchNameEn, fallback.branchAr)),
    named('branch_name_en', englishDisplayName(branchNameEn, fallback.branchEn)),
  ];
}

function named(name: SelfParameter['name'], value: string): SelfParameter {
  return { name, type: 'text', value };
}
