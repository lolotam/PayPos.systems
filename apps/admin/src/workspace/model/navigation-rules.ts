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

function concreteRoute(entry: NavigationPageEntry | undefined): string | undefined {
  if (entry?.state !== 'live' || entry.route?.includes('[')) return undefined;
  return entry.route;
}

export function navigationEntryHref(
  entry: NavigationPageEntry,
  pagesById: ReadonlyMap<string, NavigationPageEntry>,
): string {
  if (entry.state === 'soon') return soonPageHref(entry.id);
  const parent = entry.parent === undefined ? undefined : pagesById.get(entry.parent);
  // عنوان Soon لا يحمل معرّفًا لملء المسار الديناميكي، فالرابط يفتح قائمة الصفحة الأب.
  return concreteRoute(entry) ?? concreteRoute(parent) ?? '/';
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
