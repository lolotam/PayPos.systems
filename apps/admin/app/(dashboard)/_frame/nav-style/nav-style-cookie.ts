import type { NavigationStyle } from '@/workspace/nav-types';

export const NAV_STYLE_COOKIE = 'pospay_nav_style';
const YEAR_SECONDS = 60 * 60 * 24 * 365;

function cookieAttributes(maxAge: number): string {
  const secure = globalThis.location.protocol === 'https:' ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function writeNavStyleCookie(style: NavigationStyle): void {
  document.cookie = `${NAV_STYLE_COOKIE}=${style}; ${cookieAttributes(YEAR_SECONDS)}`;
}

// المتصفح قد يتشارك بين أكثر من شخص، فالخروج يمسح النمط حتى لا يرثه من يدخل بعده (FR-012).
export function clearNavStyleCookie(): void {
  document.cookie = `${NAV_STYLE_COOKIE}=; ${cookieAttributes(0)}`;
}
