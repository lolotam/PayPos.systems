// @vitest-environment node

import { t } from '@pospay/i18n';
import { describe, expect, it } from 'vitest';

import { NAVIGATION_PAGES } from '../navigation-model';
import { buildGroupOverview } from './group-overview';
import type { MenuContext } from './menu-context';
import { buildStyleAView, buildStyleBView, buildStyleCView } from './style-views';
import { visiblePageIds, type VisibilityConditions } from './visible-page-ids';

const open: VisibilityConditions = {
  always: true,
  'alert-rules-or-rating-access': true,
  'business-identity-access': true,
  'commission-plans-access': true,
  'employee-app-link-access': true,
  'imported-refunds-access': true,
  'leave-report-access': true,
  'ratings-access': true,
  'staff-app-columns-access': true,
};

function contextFor(
  pathname: string,
  businessType: 'salon' | 'restaurant' = 'restaurant',
): MenuContext {
  return {
    translate: (key) => t('en', key),
    pathname,
    visibleIds: visiblePageIds(NAVIGATION_PAGES, {
      conditions: open,
      businessType,
      country: 'KW',
      role: 'owner',
    }),
  };
}

// المرجع مكتوب يدويًا من app-map.md: قسم كل صفحة حية ثم وحدتها ومساحتها في كل نمط.
const FRONT = { a: 'sales', b: 'sell', c: 'front-desk' };
const STOCK = { a: 'catalog', b: 'stock', c: 'stock' };
const TEAM = { a: 'team', b: 'people', c: 'team' };
const REPORTS = { a: 'reports', b: 'business', c: 'business' };
const SETUP = { a: 'setup', b: 'business', c: 'business' };

const LIVE_ROUTES: readonly (readonly [string, string, { a: string; b: string; c: string }])[] = [
  ['/', 'dashboard', { a: 'home', b: 'today', c: 'front-desk' }],
  ['/orders/service-sessions/new', 'record-visit', FRONT],
  ['/orders/service-sessions', 'sessions-day-list', FRONT],
  ['/orders/package-sales/new', 'sell-package', FRONT],
  ['/orders/customers/c-1/packages', 'sessions-day-list', FRONT],
  ['/catalog', 'services', STOCK],
  ['/catalog/create', 'services', STOCK],
  ['/catalog/categories', 'categories', STOCK],
  ['/catalog/package-types', 'package-types', STOCK],
  ['/catalog/package-types/create', 'package-types', STOCK],
  ['/staff', 'employees', TEAM],
  ['/staff/create', 'employees', TEAM],
  ['/staff/e-1/leave', 'employees', TEAM],
  ['/staff/employee-numbers', 'employee-numbers', TEAM],
  ['/staff/import', 'import-employees', TEAM],
  ['/staff/document-types', 'document-types', TEAM],
  ['/schedules', 'weekly-schedules', TEAM],
  ['/staff/attendance', 'attendance-board', TEAM],
  ['/staff/attendance-requests', 'attendance-requests', TEAM],
  ['/staff/attendance-exceptions', 'attendance-exceptions', TEAM],
  ['/leave', 'leave-approvals', TEAM],
  ['/commissions/plans', 'commission-plans', TEAM],
  ['/commissions/overrides', 'commission-overrides', TEAM],
  ['/staff/attendance-report', 'attendance-report', REPORTS],
  ['/staff/attendance-statement', 'attendance-statement', REPORTS],
  ['/staff/leave-history', 'leave-history-report', REPORTS],
  ['/business-identity', 'business-identity', SETUP],
  ['/alert-rules', 'alerts-and-notifications', SETUP],
  ['/imported-refunds', 'imported-refunds', SETUP],
  ['/permissions', 'permissions', SETUP],
  ['/security/two-factor', 'sign-in-security', SETUP],
  ['/staff/employee-app-link', 'staff-app-link', SETUP],
  ['/staff-app-columns', 'staff-app-columns', SETUP],
];

describe('the current top-level entry on every live route', () => {
  it.each(LIVE_ROUTES)('%s marks exactly one entry in each style', (pathname, pageId, expected) => {
    const ctx = contextFor(pathname);
    const a = buildStyleAView(ctx);
    const b = buildStyleBView(ctx);
    const c = buildStyleCView(ctx);
    expect(a.currentGroupId).toBe(expected.a);
    expect(b.currentModuleId).toBe(expected.b);
    expect(c.currentWorkspaceId).toBe(expected.c);
    expect(a.currentPageId).toBe(pageId);
    expect(a.groups.filter((group) => group.id === a.currentGroupId)).toHaveLength(1);
    expect(b.modules.filter((module) => module.id === b.currentModuleId)).toHaveLength(1);
    expect(c.workspaces.filter((space) => space.id === c.currentWorkspaceId)).toHaveLength(1);
    expect(a.groups.find((group) => group.id === expected.a)?.pages.map((p) => p.id)).toContain(
      pageId,
    );
  });

  it('marks Staff app columns, not Employees', () => {
    const view = buildStyleAView(contextFor('/staff-app-columns'));
    expect(view.currentPageId).toBe('staff-app-columns');
    expect(view.tabs.find((tab) => tab.current)?.label).toBe(t('en', 'adminNav.submenuStaffApp'));
  });

  it('marks nothing on an unknown path', () => {
    const view = buildStyleCView(contextFor('/nowhere'));
    expect(view.currentWorkspaceId).toBeUndefined();
    expect(view.activePageId).toBeUndefined();
  });

  it('marks the Under development entry on its own address', () => {
    expect(buildStyleCView(contextFor('/soon/kitchen-screens')).currentWorkspaceId).toBe(
      'front-desk',
    );
  });
});

describe('hidden pages', () => {
  it('drops a group and a workspace left with no visible page, in every style', () => {
    const ctx = { ...contextFor('/'), visibleIds: ['dashboard'] };
    expect(buildStyleAView(ctx).groups.map((group) => group.id)).toEqual(['home']);
    expect(buildStyleBView(ctx).modules.map((module) => module.id)).toEqual(['today']);
    expect(buildStyleCView(ctx).workspaces.map((space) => space.id)).toEqual(['front-desk']);
  });

  it('drops a sub-menu with no visible page but keeps its siblings', () => {
    const ctx = { ...contextFor('/'), visibleIds: ['dashboard', 'record-visit'] };
    const sections = buildStyleCView(ctx).workspaces[0]?.sections.map((section) => section.id);
    expect(sections).toEqual(['home', 'service-visits']);
  });

  it('shows a restaurant-only entry for a restaurant and hides it for a salon, everywhere', () => {
    const labelOf = t('en', 'adminNavPages.kitchenScreens');
    const labels = (ctx: MenuContext) => [
      ...buildStyleAView(ctx).groups.flatMap((group) => group.pages.map((page) => page.label)),
      ...buildStyleBView(ctx).modules.flatMap((m) =>
        m.sections.flatMap((s) => s.pages.map((p) => p.label)),
      ),
      ...buildStyleCView(ctx).workspaces.flatMap((w) =>
        w.sections.flatMap((s) => s.pages.map((p) => p.label)),
      ),
    ];
    expect(labels(contextFor('/', 'restaurant')).filter((label) => label === labelOf)).toHaveLength(
      3,
    );
    expect(labels(contextFor('/', 'salon'))).not.toContain(labelOf);
  });
});

describe('not-built entries', () => {
  it('carries the Soon mark and the Under development address in each style', () => {
    const ctx = contextFor('/', 'restaurant');
    const soon = t('en', 'adminNav.soonBadge');
    const pages = [
      ...buildStyleAView(ctx).groups.flatMap((group) => group.pages),
      ...buildStyleBView(ctx).modules.flatMap((m) => m.sections.flatMap((s) => s.pages)),
      ...buildStyleCView(ctx).workspaces.flatMap((w) => w.sections.flatMap((s) => s.pages)),
    ];
    const kitchen = pages.filter((page) => page.id === 'kitchen-screens');
    expect(kitchen).toHaveLength(3);
    for (const page of kitchen)
      expect(page).toMatchObject({ status: soon, href: '/soon/kitchen-screens' });
    const live = pages.find((page) => page.id === 'employees');
    expect(live?.status).toBeUndefined();
  });
});

describe('style A levels', () => {
  it('keeps four groups on the phone bottom bar and the rest under More', () => {
    const view = buildStyleAView(contextFor('/staff'));
    expect(view.bottom.map((item) => item.id)).toEqual(['home', 'sales', 'catalog', 'team']);
    expect(view.more.map((group) => group.id)).toEqual(['customers', 'reports', 'setup']);
    expect(view.bottom.find((item) => item.current)?.id).toBe('team');
  });

  it('lists the tabs of the current group and the pills of the current tab', () => {
    const view = buildStyleAView(contextFor('/staff/import'));
    expect(view.tabs.find((tab) => tab.current)?.label).toBe(t('en', 'adminNav.submenuEmployees'));
    expect(view.pills.map((pill) => pill.id).slice(0, 4)).toEqual([
      'employees',
      'employee-numbers',
      'import-employees',
      'document-types',
    ]);
    expect(view.pills.find((pill) => pill.current)?.id).toBe('import-employees');
  });

  it('shows no pills for a sub-menu with a single page', () => {
    expect(buildStyleAView({ ...contextFor('/'), visibleIds: ['dashboard'] }).pills).toEqual([]);
  });
});

describe('style B and C structure', () => {
  it('points each module to its overview and carries sections of pages', () => {
    const module = buildStyleBView(contextFor('/staff')).modules.find(
      (item) => item.id === 'people',
    );
    expect(module?.href).toBe('/overview/people');
    expect(module?.sections.map((section) => section.id)).toContain('employees');
  });

  it('lists the five workspaces as phone tabs with the current one marked', () => {
    const view = buildStyleCView(contextFor('/catalog'));
    expect(view.bottom.map((item) => item.id)).toEqual([
      'front-desk',
      'stock',
      'customers',
      'team',
      'business',
    ]);
    expect(view.bottom.find((item) => item.current)?.id).toBe('stock');
  });
});

describe('group overview', () => {
  it('draws the sections of one group with a card per visible page', () => {
    const overview = buildGroupOverview('B', 'people', contextFor('/'));
    expect(overview?.label).toBe(t('en', 'adminNav.moduleBPeople'));
    const employees = overview?.sections.find((section) => section.id === 'employees');
    expect(employees?.items.map((item) => item.id).slice(0, 4)).toEqual([
      'employees',
      'employee-numbers',
      'import-employees',
      'document-types',
    ]);
    expect(employees?.items[0]?.href).toBe('/staff');
  });

  it('returns nothing for an unknown group or one with no visible page', () => {
    expect(buildGroupOverview('B', 'nowhere', contextFor('/'))).toBeUndefined();
    expect(
      buildGroupOverview('B', 'people', { ...contextFor('/'), visibleIds: [] }),
    ).toBeUndefined();
  });
});

describe('overview addresses generated by the view model', () => {
  it('marks the module of style B that owns the address, with no page marked', () => {
    const modules = buildStyleBView(contextFor('/')).modules;
    expect(modules.length).toBeGreaterThan(1);
    for (const module of modules) {
      const view = buildStyleBView(contextFor(module.href));
      expect(view.currentModuleId).toBe(module.id);
      expect(view.activePageId).toBeUndefined();
    }
  });

  it('marks the workspace of style C that owns the address of its phone tab', () => {
    for (const tab of buildStyleCView(contextFor('/')).bottom) {
      const view = buildStyleCView(contextFor(tab.href));
      expect(view.currentWorkspaceId).toBe(tab.id);
      expect(view.bottom.find((item) => item.current)?.id).toBe(tab.id);
    }
  });

  it('marks nothing for a group the style does not show or the user cannot see', () => {
    expect(buildStyleBView(contextFor('/overview/nowhere')).currentModuleId).toBeUndefined();
    const hidden = { ...contextFor('/overview/people'), visibleIds: ['dashboard'] };
    expect(buildStyleBView(hidden).currentModuleId).toBeUndefined();
  });

  it('does not treat an overview address as a place in style A', () => {
    expect(buildStyleAView(contextFor('/overview/team')).currentGroupId).toBeUndefined();
  });

  it('opens each phone workspace tab of style C on its overview, not on its first page', () => {
    const hrefs = buildStyleCView(contextFor('/')).bottom.map((item) => item.href);
    expect(hrefs).toEqual([
      '/overview/front-desk',
      '/overview/stock',
      '/overview/customers',
      '/overview/team',
      '/overview/business',
    ]);
  });
});

describe('every not-built entry', () => {
  it('carries the Soon mark and its Under development address in each of the three styles', () => {
    const ctx = contextFor('/', 'restaurant');
    const everyPage = [
      ...buildStyleAView(ctx).groups.flatMap((group) => group.pages),
      ...buildStyleBView(ctx).modules.flatMap((m) => m.sections.flatMap((s) => s.pages)),
      ...buildStyleCView(ctx).workspaces.flatMap((w) => w.sections.flatMap((s) => s.pages)),
    ];
    const soon = NAVIGATION_PAGES.filter(
      (entry) => entry.state === 'soon' && ctx.visibleIds.includes(entry.id),
    );
    expect(soon.length).toBeGreaterThan(20);
    for (const entry of soon) {
      const shown = everyPage.filter((page) => page.id === entry.id);
      expect(shown).toHaveLength(3);
      for (const page of shown) {
        expect(page).toMatchObject({
          status: t('en', 'adminNav.soonBadge'),
          href: `/soon/${entry.id}`,
        });
      }
    }
  });
});
