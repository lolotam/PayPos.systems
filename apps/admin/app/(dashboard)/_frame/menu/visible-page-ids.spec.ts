import { describe, expect, it } from 'vitest';

import type { NavigationPageEntry } from '@/workspace/nav-types';

import { NAVIGATION_PAGES } from '../navigation-model';
import { visiblePageIds, type VisibilityConditions } from './visible-page-ids';

const closed: VisibilityConditions = {
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
const open = Object.fromEntries(
  Object.keys(closed).map((key) => [key, true]),
) as VisibilityConditions;

function idsFor(input: Partial<Parameters<typeof visiblePageIds>[1]>) {
  return visiblePageIds(NAVIGATION_PAGES, {
    conditions: closed,
    businessType: 'salon',
    country: 'KW',
    role: 'owner',
    ...input,
  });
}

describe('visiblePageIds', () => {
  it('keeps a live page hidden until its own condition holds, and shows it after', () => {
    expect(idsFor({})).not.toContain('business-identity');
    expect(idsFor({ conditions: { ...closed, 'business-identity-access': true } })).toContain(
      'business-identity',
    );
  });

  it('shows the two commission pages together under one condition', () => {
    const ids = idsFor({ conditions: { ...closed, 'commission-plans-access': true } });
    expect(ids).toEqual(expect.arrayContaining(['commission-plans', 'commission-overrides']));
    expect(idsFor({})).not.toContain('commission-plans');
  });

  it('always shows pages whose condition is always', () => {
    expect(idsFor({ businessType: null, role: '' })).toEqual(
      expect.arrayContaining(['dashboard', 'employees', 'permissions']),
    );
  });

  it('hides a restaurant-only entry for a salon and shows it for a restaurant', () => {
    expect(idsFor({ businessType: 'salon' })).not.toContain('kitchen-screens');
    expect(idsFor({ businessType: 'restaurant' })).toContain('kitchen-screens');
  });

  it('hides a business-type entry while the business type is still unknown', () => {
    expect(idsFor({ businessType: null })).not.toContain('kitchen-screens');
  });

  it('shows a not-built entry only to the roles it names', () => {
    expect(idsFor({ businessType: 'restaurant', role: 'owner' })).toContain('kitchen-screens');
    expect(idsFor({ businessType: 'restaurant', role: 'cashier' })).not.toContain(
      'kitchen-screens',
    );
    expect(idsFor({ businessType: 'restaurant', role: '' })).not.toContain('kitchen-screens');
  });

  it('shows Appearance to any role, including a custom one', () => {
    expect(idsFor({ role: 'custom_front_desk' })).toContain('appearance');
  });

  it('shows every page when every condition holds for a restaurant owner in Kuwait', () => {
    const ids = idsFor({ conditions: open, businessType: 'restaurant' });
    expect(ids).toContain('imported-refunds');
    expect(ids.length).toBeGreaterThan(idsFor({}).length);
  });
});

describe('a built page limited to one business type', () => {
  const built: NavigationPageEntry = {
    id: 'restaurant-only-built',
    labelKey: 'adminNavPages.kitchenScreens',
    icon: 'Monitor',
    state: 'live',
    route: '/restaurant-only',
    visible: 'always',
    section: 'sales',
    submenu: 'restaurant',
    businessTypes: ['restaurant'],
    appMapEntry: false,
  };
  const idsFor = (businessType: 'salon' | 'restaurant' | null) =>
    visiblePageIds([built], { conditions: closed, businessType, country: 'KW', role: 'owner' });

  it('is shown for a restaurant, hidden for a salon, and hidden while the type is unknown', () => {
    expect(idsFor('restaurant')).toEqual(['restaurant-only-built']);
    expect(idsFor('salon')).toEqual([]);
    expect(idsFor(null)).toEqual([]);
  });
});
