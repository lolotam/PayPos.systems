import { describe, expect, it } from 'vitest';

import { NAVIGATION_PAGES } from '../navigation-model';
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
  ])('forwards the old address of the built entry %s to %s', (id, href) => {
    expect(resolveSoonTarget(id, owner)).toEqual({ kind: 'forward', href });
  });
});
