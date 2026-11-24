export const NAV_STYLE_COOKIE = 'pospay_nav_style';

/** سمات الكوكي المشتركة بين الكتابة والمسح: المسار والمدة ونفس الموقع، و`Secure` على https فقط. */
export function navStyleCookieAttributes(maxAge: number): string {
  const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

/**
 * يمسح تفضيل المستخدم السابق عند خروج مؤكد أو دخول لا يرجع قيمة حساب صالحة، حتى يبدأ على C.
 */
export function clearNavStyleCookie(): void {
  document.cookie = `${NAV_STYLE_COOKIE}=; ${navStyleCookieAttributes(0)}`;
}
import type { NavigationStyle } from '@/workspace/nav-types';


const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function writeNavStyleCookie(style: NavigationStyle): void {
  document.cookie = `${NAV_STYLE_COOKIE}=${style}; ${navStyleCookieAttributes(YEAR_SECONDS)}`;
}
