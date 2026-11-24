export const NAV_STYLE_COOKIE = 'pospay_nav_style';

/** سمات الكوكي المشتركة بين الكتابة والمسح: المسار والمدة ونفس الموقع، و`Secure` على https فقط. */
export function navStyleCookieAttributes(maxAge: number): string {
  const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * يمسح نمط التنقّل المحفوظ على الجهاز، فيبدأ المستخدم التالي على النمط الافتراضي.
 * المتصفح قد يتشارك بين أكثر من شخص، فكل دخول وكل خروج يمسحانه حتى لا يرثه من يدخل بعده (FR-012)،
 * إلى أن يُحفظ الاختيار على الحساب في الخطوة 12.
 */
export function clearNavStyleCookie(): void {
  document.cookie = `${NAV_STYLE_COOKIE}=; ${navStyleCookieAttributes(0)}`;
}
