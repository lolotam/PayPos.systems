import { NAV_STYLE_COOKIE, navStyleCookieAttributes } from '@/shared/nav-style/nav-style-cookie';
import type { NavigationStyle } from '@/workspace/nav-types';

export { clearNavStyleCookie, NAV_STYLE_COOKIE } from '@/shared/nav-style/nav-style-cookie';

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function writeNavStyleCookie(style: NavigationStyle): void {
  document.cookie = `${NAV_STYLE_COOKIE}=${style}; ${navStyleCookieAttributes(YEAR_SECONDS)}`;
}
