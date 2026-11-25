import type { Country } from '@pospay/contracts';

import type {
  LiveRoutePageEntry,
  NavigationBusinessType,
  NavigationPageEntry,
  SoonNavigationPageEntry,
  TopLevelNavigationPageEntry,
} from '../nav-types';

export function isTopLevelPage(entry: NavigationPageEntry): entry is TopLevelNavigationPageEntry {
  return entry.parent === undefined;
}

export function isLiveRoutePage(entry: NavigationPageEntry): entry is LiveRoutePageEntry {
  return entry.state === 'live' && entry.route !== undefined;
}

export function soonPageHref(pageId: string): string {
  return `/soon/${pageId}`;
}

function isConcreteRoute(route: string | undefined): route is string {
  return (
    route !== undefined && route.startsWith('/') && !route.includes('[') && !route.includes(']')
  );
}

/**
 * وجهة التحويل الصالحة لرابط `/soon/<id>` بعد ترقية المدخل إلى `live` (#1167):
 * - إذا صُرّح بوجهة ملموسة (`formerSoonDestination`) تُستعمل إن لم تحتوِ معامل مسار.
 * - الصفحة الحية ذات المسار الثابت تحوّل لمسارها مباشرة.
 * - الصفحة ذات المسار الديناميكي بلا `formerSoonDestination` ملموسة تعيد `undefined` (لا تحوّل للأب ولا للرئيسية).
 * - الصفحة المضمّنة (`embeddedInParent`) تحوّل لمسار صفحتها الأب الحية متى كان ثابتًا ملموسًا.
 */
export function promotedSoonDestination(
  entry: NavigationPageEntry,
  pagesById: ReadonlyMap<string, NavigationPageEntry>,
): string | undefined {
  if (entry.state === 'soon') return undefined;
  if (entry.formerSoonDestination !== undefined) {
    return isConcreteRoute(entry.formerSoonDestination) ? entry.formerSoonDestination : undefined;
  }
  if (entry.route !== undefined) return isConcreteRoute(entry.route) ? entry.route : undefined;
  const parent = pagesById.get(entry.parent);
  return parent?.state === 'live' && isConcreteRoute(parent.route) ? parent.route : undefined;
}

export function navigationEntryHref(
  entry: NavigationPageEntry,
  pagesById: ReadonlyMap<string, NavigationPageEntry>,
): string {
  if (entry.state === 'soon') return soonPageHref(entry.id);
  return promotedSoonDestination(entry, pagesById) ?? '/';
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

function matchesNavigationRoute(routePattern: string, pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);
  if (!routePattern.includes('[')) return normalizedPath === routePattern;
  const patternParts = routePattern.split('/');
  const pathParts = normalizedPath.split('/');
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => {
    const segment = pathParts[index];
    if (part.startsWith('[') && part.endsWith(']'))
      return segment !== undefined && segment.length > 0;
    return part === segment;
  });
}

export function findNavigationEntryByPathname(
  pathname: string,
  pages: readonly NavigationPageEntry[],
): NavigationPageEntry | undefined {
  const normalized = normalizePathname(pathname);
  if (normalized.startsWith('/soon/')) {
    // FR-023: the route checks the matched entry's current visibility before opening or forwarding.
    const id = normalized.slice('/soon/'.length);
    const matches = pages.filter(
      (entry) => (entry.state === 'soon' ? entry.id : entry.formerSoonId) === id,
    );
    return matches.length === 1 ? matches[0] : undefined;
  }
  const livePages = pages.filter(isLiveRoutePage);
  const exact = livePages.find((entry) => !entry.route.includes('[') && entry.route === normalized);
  if (exact !== undefined) return exact;
  return livePages.find(
    (entry) => entry.route.includes('[') && matchesNavigationRoute(entry.route, normalized),
  );
}

export function resolveMenuEntry(
  matched: NavigationPageEntry | undefined,
  pagesById: ReadonlyMap<string, NavigationPageEntry>,
): TopLevelNavigationPageEntry | undefined {
  if (matched === undefined) return undefined;
  if (isTopLevelPage(matched)) return matched;
  if (matched.parent === undefined) return undefined;
  const parent = pagesById.get(matched.parent);
  return parent !== undefined && isTopLevelPage(parent) ? parent : undefined;
}

export function isEntryShownForWorkspace(
  entry: NavigationPageEntry,
  businessType: NavigationBusinessType | null,
  countryCode: Country | null,
): boolean {
  if (entry.businessTypes.length > 0) {
    if (businessType === null || !entry.businessTypes.includes(businessType)) return false;
  }
  if (entry.countries !== undefined && entry.countries.length > 0) {
    if (countryCode === null || !entry.countries.includes(countryCode)) return false;
  }
  return true;
}

export function isSoonEntryShownForRole(entry: SoonNavigationPageEntry, role: string): boolean {
  return entry.roles.some((allowed) => allowed === role);
}
