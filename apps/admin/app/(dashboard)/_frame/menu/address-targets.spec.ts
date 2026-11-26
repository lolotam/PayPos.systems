import { describe, expect, it } from 'vitest';

import { navigationEntryHref, promotedSoonDestination } from '@/workspace/model/navigation-rules';
import type {
  EmbeddedLivePageEntry,
  LiveRoutePageEntry,
  NavigationPageEntry,
} from '@/workspace/nav-types';

import { NAVIGATION_PAGES, pageSoonDestination } from '../navigation-model';
import type { MenuContext } from './menu-context';
import { resolveOverviewTarget } from './overview-target';
import { resolveSoonTarget } from './soon-target';
import { resolveTopLevels } from './resolve-top-levels';
import { visiblePageIds, type VisibilityConditions } from './visible-page-ids';

const CLOSED: VisibilityConditions = {
  always: true,
  'alert-rules-or-rating-access': false,
  'business-identity-access': false,
  'commission-plans-access': false,
  'employee-app-link-access': false,
  'imported-refunds-access': false,
  'invitations-owner': false,
  'leave-report-access': false,
  'ratings-access': false,
  'staff-app-columns-access': false,
};
const OPEN: VisibilityConditions = Object.fromEntries(
  Object.keys(CLOSED).map((key) => [key, true]),
) as unknown as VisibilityConditions;

function contextFor(
  conditions: VisibilityConditions,
  role: string,
  businessType: 'salon' | 'restaurant' | null = 'salon',
): MenuContext {
  return {
    translate: (key) => key,
    pathname: '/',
    visibleIds: visiblePageIds(NAVIGATION_PAGES, {
      conditions,
      businessType,
      country: 'KW',
      role,
    }),
  };
}

describe('what an overview address does', () => {
  it('shows the overview of a group that is in the current style', () => {
    const target = resolveOverviewTarget('C', 'team', contextFor(OPEN, 'owner'));
    expect(target.kind).toBe('overview');
    if (target.kind === 'overview') expect(target.overview.id).toBe('team');
  });

  it('replaces a group of another style with the first page the user may see', () => {
    const ctx = contextFor(OPEN, 'owner');
    const target = resolveOverviewTarget('C', 'sell', ctx);
    const first = resolveTopLevels('B', ctx).find((item) => item.id === 'sell')?.href;
    expect(first).toBeDefined();
    expect(target).toEqual({ kind: 'replace', href: first });
  });

  it('sends an unknown group to Home', () => {
    expect(resolveOverviewTarget('B', 'no-such-group', contextFor(OPEN, 'owner'))).toEqual({
      kind: 'replace',
      href: '/',
    });
  });

  it('sends a group with nothing visible to Home', () => {
    const nothing: MenuContext = { ...contextFor(OPEN, 'owner'), visibleIds: [] };
    expect(resolveOverviewTarget('C', 'team', nothing)).toEqual({ kind: 'replace', href: '/' });
    expect(resolveOverviewTarget('C', 'sell', nothing)).toEqual({ kind: 'replace', href: '/' });
  });
});

describe('what a Soon address does', () => {
  const owner = contextFor(OPEN, 'owner');

  it('treats an unknown id as not found', () => {
    expect(resolveSoonTarget('no-such-page', owner)).toEqual({ kind: 'not-found' });
  });

  it('opens the Under development page with the name of a not-built entry', () => {
    expect(resolveSoonTarget('kitchen-screens', contextFor(OPEN, 'owner', 'restaurant'))).toEqual({
      kind: 'under-development',
      name: 'adminNavPages.kitchenScreens',
      homeHref: '/',
    });
  });

  it('hides a restaurant-only entry from a salon', () => {
    expect(resolveSoonTarget('kitchen-screens', contextFor(OPEN, 'owner', 'salon'))).toEqual({
      kind: 'not-found',
    });
  });

  it('hides a not-built entry from a role it was not planned for', () => {
    expect(resolveSoonTarget('subscription-and-billing', contextFor(OPEN, 'cashier'))).toEqual({
      kind: 'not-found',
    });
  });

  it.each([
    ['appearance', '/appearance'],
    ['approvals-inbox', '/approvals'],
    ['pos-devices-and-pins', '/devices'],
  ])('forwards the old address of the built entry %s to %s', (id, href) => {
    expect(resolveSoonTarget(id, owner)).toEqual({ kind: 'forward', href });
  });
});

describe('promoted Soon alias destinations (#1167)', () => {
  const owner = contextFor(OPEN, 'owner');

  it('requires explicit concrete destination for promoted dynamic aliases and rejects missing or parameterized ones', () => {
    const customPages = buildAliasTestPages();
    const visibleAll: MenuContext = { ...owner, visibleIds: customPages.map((entry) => entry.id) };
    const unauthorized: MenuContext = { ...owner, visibleIds: [] };

    expect(resolveSoonTarget('old-catalog', visibleAll, customPages)).toEqual({
      kind: 'forward',
      href: '/catalog',
    });
    expect(resolveSoonTarget('legacy-leave-picker', visibleAll, customPages)).toEqual({
      kind: 'forward',
      href: '/staff/leave-picker',
    });
    expect(resolveSoonTarget('legacy-embedded', visibleAll, customPages)).toEqual({
      kind: 'forward',
      href: '/staff',
    });
    for (const id of [
      'legacy-leave',
      'legacy-missing',
      'legacy-param-parent',
      'legacy-embedded-param',
    ]) {
      expect(resolveSoonTarget(id, visibleAll, customPages)).toEqual({ kind: 'not-found' });
    }
    expect(resolveSoonTarget('legacy-leave-picker', unauthorized, customPages)).toEqual({
      kind: 'not-found',
    });
    expect(resolveSoonTarget('customer-packages', owner)).toEqual({ kind: 'not-found' });
  });

  it('keeps published formerSoonId entries concrete and rejects dynamic explicit destinations', () => {
    const aliases = NAVIGATION_PAGES.filter(
      (entry): entry is Exclude<NavigationPageEntry, { state: 'soon' }> =>
        entry.state === 'live' && entry.formerSoonId !== undefined,
    );
    expect(aliases.length).toBeGreaterThan(0);
    for (const entry of aliases) {
      const dest = pageSoonDestination(entry);
      expect(dest).toMatch(/^\//);
      expect(dest).not.toContain('[');
    }
    const pages = buildAliasTestPages();
    const byId = new Map(pages.map((entry) => [entry.id, entry]));
    const explicitEntry = pages.find(
      (entry) => entry.id === 'emp-leave-explicit',
    ) as LiveRoutePageEntry;
    const explicitDynamic: LiveRoutePageEntry = {
      ...explicitEntry,
      formerSoonDestination: '/staff/[employeeId]/leave',
    };
    expect(promotedSoonDestination(explicitDynamic, byId)).toBeUndefined();
    expect(navigationEntryHref(explicitEntry, byId)).toBe('/staff/leave-picker');
  });
});

const ALIAS_TEST_LIVE_BASE: LiveRoutePageEntry = {
  id: 'staff-list',
  route: '/staff',
  labelKey: 'catalogServices.listTitle',
  icon: 'Store',
  visible: 'always',
  state: 'live',
  section: 'catalog',
  submenu: 'catalog',
  businessTypes: [],
  appMapEntry: true,
};

const ALIAS_TEST_EMBEDDED_BASE: EmbeddedLivePageEntry = {
  id: 'embedded-promoted',
  parent: 'staff-list',
  embeddedInParent: true,
  formerSoonId: 'legacy-embedded',
  labelKey: 'catalogServices.listTitle',
  icon: 'Store',
  visible: 'always',
  state: 'live',
  section: 'catalog',
  submenu: 'catalog',
  businessTypes: [],
  appMapEntry: true,
};

function buildAliasTestPages(): readonly NavigationPageEntry[] {
  const dynamicChild: LiveRoutePageEntry = {
    ...ALIAS_TEST_LIVE_BASE,
    id: 'emp-leave-none',
    route: '/staff/[employeeId]/leave',
    parent: 'staff-list',
    formerSoonId: 'legacy-leave',
  };
  return [
    ALIAS_TEST_LIVE_BASE,
    { ...ALIAS_TEST_LIVE_BASE, id: 'static-promoted', route: '/catalog', formerSoonId: 'old-catalog' },
    { ...ALIAS_TEST_LIVE_BASE, id: 'staff-detail', route: '/staff/[employeeId]' },
    dynamicChild,
    {
      ...dynamicChild,
      id: 'emp-leave-missing-parent',
      parent: 'no-such-parent',
      formerSoonId: 'legacy-missing',
    },
    {
      ...dynamicChild,
      id: 'emp-leave-param-parent',
      parent: 'staff-detail',
      formerSoonId: 'legacy-param-parent',
    },
    {
      ...dynamicChild,
      id: 'emp-leave-explicit',
      formerSoonId: 'legacy-leave-picker',
      formerSoonDestination: '/staff/leave-picker',
    },
    ALIAS_TEST_EMBEDDED_BASE,
    {
      ...ALIAS_TEST_EMBEDDED_BASE,
      id: 'embedded-param-parent',
      parent: 'staff-detail',
      formerSoonId: 'legacy-embedded-param',
    },
  ];
}
