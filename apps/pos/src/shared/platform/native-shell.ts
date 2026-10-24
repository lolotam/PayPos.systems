/**
 * هل البناء ده نسخة التطبيق الأصلي جوّه «PosPay Business» ولا نسخة الويب (PWA)؟
 *
 * المكان ده هو اللي بيقرر، مفيش شاشة بتفحص المنصة بنفسها (spec 065 FR-006)،
 * و FR-006 بيكبّر المكان ده نفسه لبوابة قدرات في M-1d.
 *
 * @returns true في نسخة التطبيق الأصلي، false في نسخة الويب
 */
export function isNativeShell(): boolean {
  return import.meta.env.VITE_NATIVE === '1';
}

/**
 * الـ host بتاع نسخة التطبيق الأصلي: نفس الـ host اللي مضمون في البناء.
 *
 * ده ثابت مش `location.host`: على iOS الصفحة بتفتح على `capacitor://localhost` (ADR-0055 قرار 3)،
 * فلو قرأنا الـ host من الصفحة هنقبل لينك على مضيف غلط. نسخة الويب ما بتستدعيش الدالة دي،
 * لأن قراءة اللينك شغل نسخة التطبيق بس.
 *
 * @returns الـ host المضمون في البناء
 */
export function nativePosHost(): string {
  const host = import.meta.env.VITE_POS_HOST;
  if (!host) throw new Error('NATIVE_POS_HOST_MISSING');
  return host;
}

/**
 * هل نسخة التطبيق اللي قدام المستخدم دلوقتي هي نسخة التجربة (staging)؟
 *
 * لازم الإجابة تكون واضحة من غير ما أي شاشة تفحص المنصة بنفسها (FR-006)، لأن نسخة
 * التجربة بتتكلم مع سيرفر التجربة وبياناتها بيانات اختبار: المختبِر لازم ما يخلطهاش
 * بالنسخة الحقيقية فيدخل على بيانات زبائن حقيقية بالغلط (APP-Q13).
 *
 * @returns true في نسخة التطبيق من نوع staging، false في نسخة الإنتاج أو في نسخة الويب
 */
export function isStagingApp(): boolean {
  return isNativeShell() && import.meta.env.VITE_NATIVE_FLAVOUR === 'staging';
}
