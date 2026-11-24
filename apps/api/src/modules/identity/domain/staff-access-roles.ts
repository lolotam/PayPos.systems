// دورا إعطاء الدخول الثابتان (قرار D1): الاختيار من اتنين بس، والجدول هو اللي بيربط الكود المطلوب
// بدور النظام الفعلي — إضافة دور تالت تبقى صف بيانات هنا، مش فرع if جديد في use case.

/**
 * الأدوار اللي بيقدمها طلب «إعطاء دخول» كأكواد مغلقة.
 * `staff` = موظفة، و`reception` = استقبال/كاشير ويترجم لدور النظام `cashier`.
 */
export const STAFF_ACCESS_ROLES = ['staff', 'reception'] as const;

export type StaffAccessRole = (typeof STAFF_ACCESS_ROLES)[number];

/**
 * بيرجم كود الطلب لكود دور النظام في memberships.
 * القرار D1: «استقبال/كاشير» بياخد دور النظام `cashier` عشان صلاحيات الحضور والزيارات الافتراضية تيجي معاه.
 *
 * @param role كود الدور الجاي من الطلب (من enum مغلق مش نص حر)
 * @returns كود دور النظام الثابت اللي العضوية بتتخزن بيه
 */
export function staffAccessSystemRole(role: StaffAccessRole): 'staff' | 'cashier' {
  return role === 'reception' ? 'cashier' : role;
}

/**
 * عمر الرقم السري المؤقت قبل ما يعتبر منتهي لو ما اتاستخدمش (قرار D4، FR-F2-1).
 * القيمة دي ثابتة من F1 عشان الأعمدة تتكتب مرة واحدة صح، وتدفق التغيير نفسه بيتضاف في F2.
 */
export const TEMPORARY_STAFF_PIN_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * بيحسب لحظة انتهاء الرقم السري المؤقت من لحظة الضبط.
 * الحساب هنا مش في use case (CLAUDE.md §4.2) والوظيفة pure عشان تتقاس بلا ساعة حقيقية.
 *
 * @param setAt لحظة ضبط الرقم من المانح
 * @returns لحظة الانتهاء: `setAt` زائد 24 ساعة
 */
export function temporaryStaffPinExpiresAt(setAt: Date): Date {
  return new Date(setAt.getTime() + TEMPORARY_STAFF_PIN_TTL_MS);
}
