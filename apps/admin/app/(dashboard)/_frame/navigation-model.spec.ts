// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { t, type MessageKey } from '@pospay/i18n';
import * as UI from '@pospay/ui';
import { describe, expect, it } from 'vitest';

import {
  findNavigationEntryByPathname,
  isEntryShownForWorkspace,
  isLiveRoutePage,
  isSoonEntryShownForRole,
  promotedSoonDestination,
  soonPageHref,
} from '@/workspace/model/navigation-rules';
import type {
  EmbeddedLivePageEntry,
  LiveRoutePageEntry,
  NavigationPageEntry,
  NavigationStyle,
  TopLevelNavigationPageEntry,
} from '@/workspace/nav-types';

import {
  APP_MAP_MANAGEMENT_PAGES,
  DEFAULT_NAVIGATION_STYLE,
  findNavigationPageByPathname,
  findTopLevelGroupForPage,
  NAVIGATION_GROUPINGS,
  NAVIGATION_PAGES,
  NAVIGATION_SECTIONS,
  NAVIGATION_STYLES,
  NAVIGATION_SUBMENUS,
  pageEntryHref,
  parseNavigationStyle,
  resolveMenuEntryForPathname,
  TOP_LEVEL_NAVIGATION_PAGES,
} from './navigation-model';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ADMIN_APP_DIR = resolve(HERE, '../..');
const REPO_ROOT = resolve(ADMIN_APP_DIR, '../../..');
const SPEC_DIR = join(REPO_ROOT, 'docs/specs/074-admin-navigation-layout-restructure');
// عناوين يملكها الإطار نفسه لا الصفحات: نظرة المجموعة وصفحة «قريبًا»؛ ليست مدخلًا في القوائم.
const FRAME_HOST_ROUTES = ['/overview/[group]', '/soon/[page]'];
const ARABIC_SCRIPT = /[\u0600-\u06FF]/;

function collectRouteFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...collectRouteFiles(full));
    else if (entry.name === 'page.tsx') results.push(full);
  }
  return results;
}

function fileToRoute(filePath: string, baseDir: string): string {
  const rel = relative(baseDir, filePath).replaceAll('\\', '/');
  const trimmed = rel.replace(/(^|\/)page\.tsx$/, '');
  return trimmed === '' ? '/' : `/${trimmed}`;
}

function listAdminDashboardRoutes(): string[] {
  const dashboardDir = join(ADMIN_APP_DIR, '(dashboard)');
  return collectRouteFiles(dashboardDir)
    .map((file) => fileToRoute(file, dashboardDir))
    .filter((route) => !FRAME_HOST_ROUTES.includes(route))
    .sort();
}

function parseManagementAppMapRows(): { live: number; soon: number; fresh: number; total: number } {
  const content = readFileSync(join(SPEC_DIR, 'app-map.md'), 'utf8');
  const manageSection = content.split('## Management area')[1]?.split('## Other areas')[0] ?? '';
  let live = 0;
  let soon = 0;
  let fresh = 0;
  for (const line of manageSection.split(/\r?\n/)) {
    if (!line.startsWith('|') || line.startsWith('|---') || line.includes('| Phase |')) continue;
    const cells = line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    // Home tables have 5 columns (Page|Phase|State|Shown|Roles); other sections have 6 (Sub-menu|Page|Phase|State|Shown|Roles).
    const stateCell = cells.length === 6 ? cells[3] : cells[2];
    if (stateCell?.startsWith('Live')) live += 1;
    else if (stateCell === 'Soon') soon += 1;
    else if (stateCell === 'New') fresh += 1;
  }
  return { live, soon, fresh, total: live + soon + fresh };
}

function isLiveEntry(
  entry: NavigationPageEntry,
): entry is LiveRoutePageEntry | EmbeddedLivePageEntry {
  return entry.state === 'live';
}

function requiredMenuEntryForPathname(pathname: string): TopLevelNavigationPageEntry {
  const entry = resolveMenuEntryForPathname(pathname);
  if (entry === undefined) throw new Error(`No active menu entry for ${pathname}`);
  return entry;
}

function requiredPageById(id: string): NavigationPageEntry {
  const entry = NAVIGATION_PAGES.find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`Missing navigation page: ${id}`);
  return entry;
}

function flattenGroupingPageIds(style: NavigationStyle): string[] {
  if (style === 'A') {
    return NAVIGATION_GROUPINGS.A.flatMap((group) => group.tabs.flatMap((tab) => [...tab.pageIds]));
  }
  if (style === 'B') {
    return NAVIGATION_GROUPINGS.B.flatMap((mod) => mod.columns.flatMap((col) => [...col.pageIds]));
  }
  return NAVIGATION_GROUPINGS.C.flatMap((ws) =>
    ws.panelSections.flatMap((section) => [...section.pageIds]),
  );
}

describe('navigation model route coverage (074-1 + 074-2)', () => {
  it('covers every (dashboard) page.tsx route, the Authenticator page included, exactly once', () => {
    const diskRoutes = listAdminDashboardRoutes();
    const liveRoutes = NAVIGATION_PAGES.filter(isLiveRoutePage).map((entry) => entry.route);

    expect(new Set(liveRoutes).size).toBe(liveRoutes.length);
    expect([...liveRoutes].sort()).toEqual(diskRoutes);
    expect(diskRoutes).toContain('/security/two-factor');
    expect(diskRoutes).toContain('/staff-app-columns');
  });

  it('leaves live entries without a former Soon alias and unknown IDs unresolved', () => {
    expect(findNavigationPageByPathname(soonPageHref('services'))).toBeUndefined();
    expect(findNavigationPageByPathname(soonPageHref('service-create'))).toBeUndefined();
    expect(findNavigationPageByPathname(soonPageHref('unknown-entry'))).toBeUndefined();
  });

  it('resolves a promoted child through its published Soon alias', () => {
    const child = requiredPageById('service-create');
    if (!isLiveRoutePage(child)) throw new Error('Expected a live child route');
    const promoted = { ...child, formerSoonId: 'new-services' };
    expect(findNavigationEntryByPathname(soonPageHref('new-services'), [promoted])).toBe(promoted);
  });

  it('resolves an embedded page through its published Soon alias', () => {
    // إعدادات الجداول بقت صفحة مستقلة، فالمدخل المضمّن بيتبني من قيمة حرفية هنا.
    const embedded: EmbeddedLivePageEntry = {
      id: 'embedded-example',
      parent: 'weekly-schedules',
      embeddedInParent: true,
      labelKey: 'shell.schedule_settings_title',
      icon: 'Clock3',
      visible: 'always',
      state: 'live',
      section: 'team',
      submenu: 'schedules',
      businessTypes: [],
      appMapEntry: true,
      formerSoonId: 'new-schedules',
    };
    expect(findNavigationEntryByPathname(soonPageHref('new-schedules'), [embedded])).toBe(embedded);
  });

  it('keeps current and former Soon IDs unique', () => {
    const ids = NAVIGATION_PAGES.map((entry) => (entry.state === 'soon' ? entry.id : entry.formerSoonId))
      .filter((id) => id !== undefined);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves a collision between a current Soon ID and a former alias unresolved', () => {
    const live = requiredPageById('services');
    if (!isLiveRoutePage(live)) throw new Error('Expected a live route');
    const soon = requiredPageById('kitchen-screens');
    const entries = [soon, { ...live, formerSoonId: soon.id }];
    expect(findNavigationEntryByPathname(soonPageHref(soon.id), entries)).toBeUndefined();
  });
});

describe('promoted Soon destination rules (#1167)', () => {
  it('requires explicit concrete destination for a promoted dynamic child (#1167)', () => {
    const child = requiredPageById('employee-leave');
    if (!isLiveRoutePage(child)) throw new Error('Expected a live child route');
    const parent = requiredPageById('employees');
    const promoted = { ...child, formerSoonId: 'leave-detail' };
    expect(promotedSoonDestination(promoted, new Map([[parent.id, parent]]))).toBeUndefined();
    expect(
      promotedSoonDestination(
        { ...promoted, formerSoonDestination: '/staff/leave-picker' },
        new Map([[parent.id, parent]]),
      ),
    ).toBe('/staff/leave-picker');
  });
});

describe('navigation model alignment with generated app-map', () => {
  it('matches the Management-area status totals and records roles in the app map', () => {
    const mapCounts = parseManagementAppMapRows();
    const liveAppMap = APP_MAP_MANAGEMENT_PAGES.filter((entry) => entry.state === 'live');
    const soonAppMap = APP_MAP_MANAGEMENT_PAGES.filter((entry) => entry.state === 'soon');

    expect(APP_MAP_MANAGEMENT_PAGES).toHaveLength(mapCounts.total);
    expect(liveAppMap).toHaveLength(mapCounts.live);
    expect(mapCounts.fresh).toBe(0);
    expect(soonAppMap).toHaveLength(mapCounts.soon);
    expect(liveAppMap.map((entry) => entry.id)).toEqual(
      expect.arrayContaining(['appearance', 'approvals-inbox']),
    );

    expect(readFileSync(join(SPEC_DIR, 'app-map.md'), 'utf8')).not.toContain('| not set |');
  });
});

describe('navigation groupings and active route resolution', () => {
  it.each(NAVIGATION_STYLES)(
    'places every top-level entry exactly once in grouping %s and respects top-level limits',
    (style) => {
      const ids = flattenGroupingPageIds(style);
      const expectedIds = TOP_LEVEL_NAVIGATION_PAGES.map((entry) => entry.id);

      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual([...expectedIds].sort());

      for (const entry of NAVIGATION_PAGES) {
        if (entry.parent !== undefined) {
          expect(ids).not.toContain(entry.id);
        }
      }

      if (style === 'A') {
        expect(NAVIGATION_GROUPINGS.A).toHaveLength(7);
        expect(NAVIGATION_GROUPINGS.A.filter((group) => group.bottomBar).length).toBeLessThanOrEqual(4);
      } else if (style === 'B') {
        expect(NAVIGATION_GROUPINGS.B).toHaveLength(6);
      } else {
        expect(NAVIGATION_GROUPINGS.C).toHaveLength(5);
      }
    },
  );

  it('resolves every live route and child route to exactly one active top-level entry in A, B and C', () => {
    const sampleRoutes = listAdminDashboardRoutes().map((route) =>
      route.replace('[employeeId]', 'emp-123').replace('[customerId]', 'customer-123'),
    );

    for (const pathname of sampleRoutes) {
      const menuEntry = requiredMenuEntryForPathname(pathname);
      for (const style of NAVIGATION_STYLES) {
        expect(findTopLevelGroupForPage(style, menuEntry.id)).toBeDefined();
      }
    }

    // FR-017: /staff-app-columns marks its own Setup entry, never Employees.
    expect(resolveMenuEntryForPathname('/staff-app-columns')?.id).toBe('staff-app-columns');
    expect(findTopLevelGroupForPage('A', 'staff-app-columns')).toBe('setup');
    expect(resolveMenuEntryForPathname('/staff/emp-123/leave')?.id).toBe('employees');
    expect(resolveMenuEntryForPathname('/catalog/create')?.id).toBe('services');
    expect(resolveMenuEntryForPathname('/security/two-factor')?.id).toBe('sign-in-security');
    expect(resolveMenuEntryForPathname('/orders/customers/customer-123/packages')?.id).toBe(
      'sessions-day-list',
    );
    expect(resolveMenuEntryForPathname('/imported-refunds')?.id).toBe('imported-refunds');
    expect(findNavigationPageByPathname(soonPageHref('kitchen-screens'))?.id).toBe(
      'kitchen-screens',
    );
  });

});

describe('schedule settings placement', () => {
  it('puts the schedule settings page where design.md §4 puts it in each style', () => {
    const teamTabs = NAVIGATION_GROUPINGS.A.find((group) => group.id === 'team')?.tabs ?? [];
    const schedulesTab = teamTabs.find((tab) => tab.id === 'schedules');
    expect(schedulesTab?.pageIds).toContain('weekly-schedules');
    expect(schedulesTab?.pageIds).toContain('schedule-settings');

    const peopleColumns = NAVIGATION_GROUPINGS.B.find((mod) => mod.id === 'people')?.columns ?? [];
    const businessColumns = NAVIGATION_GROUPINGS.B.find((mod) => mod.id === 'business')?.columns ?? [];
    expect(peopleColumns.find((column) => column.id === 'schedules')?.pageIds).not.toContain(
      'schedule-settings',
    );
    expect(businessColumns.find((column) => column.id === 'business')?.pageIds).toContain(
      'schedule-settings',
    );

    const teamSections =
      NAVIGATION_GROUPINGS.C.find((workspace) => workspace.id === 'team')?.panelSections ?? [];
    expect(teamSections.find((section) => section.id === 'schedules')?.pageIds).toContain(
      'schedule-settings',
    );

    expect(findTopLevelGroupForPage('A', 'schedule-settings')).toBe('team');
    expect(findTopLevelGroupForPage('B', 'schedule-settings')).toBe('business');
    expect(findTopLevelGroupForPage('C', 'schedule-settings')).toBe('team');
  });
});

describe('navigation translation and icon coverage', () => {
  it('resolves every labelKey and descriptionKey in ar and en and uses exported @pospay/ui icons', () => {
    const keys = new Set<MessageKey>();
    const icons = new Set<string>();

    for (const section of NAVIGATION_SECTIONS) keys.add(section.labelKey);
    for (const submenu of Object.values(NAVIGATION_SUBMENUS)) keys.add(submenu.labelKey);
    for (const entry of NAVIGATION_PAGES) {
      keys.add(entry.labelKey);
      if (entry.descriptionKey !== undefined) keys.add(entry.descriptionKey);
      icons.add(entry.icon);
    }
    for (const group of NAVIGATION_GROUPINGS.A) {
      keys.add(group.labelKey);
      icons.add(group.icon);
      for (const tab of group.tabs) keys.add(tab.labelKey);
    }
    for (const mod of NAVIGATION_GROUPINGS.B) {
      keys.add(mod.labelKey);
      keys.add(mod.descriptionKey);
      icons.add(mod.icon);
      for (const column of mod.columns) keys.add(column.labelKey);
    }
    for (const workspace of NAVIGATION_GROUPINGS.C) {
      keys.add(workspace.labelKey);
      keys.add(workspace.descriptionKey);
      icons.add(workspace.icon);
      for (const section of workspace.panelSections) keys.add(section.labelKey);
    }

    for (const key of keys) {
      const enText = t('en', key);
      const arText = t('ar', key);
      expect(enText).not.toBe(key);
      expect(arText).not.toBe(key);
      expect(enText.trim()).not.toBe('');
      expect(arText.trim()).not.toBe('');
      expect(enText).not.toMatch(ARABIC_SCRIPT);
      expect(arText).toMatch(ARABIC_SCRIPT);
    }

    for (const iconName of icons) {
      expect(UI).toHaveProperty(iconName);
    }
  });
});

describe('navigation visibility and count boundaries', () => {
  it('preserves live visibility and count boundaries without inventing new rules', () => {
    const guarded = NAVIGATION_PAGES.filter(isLiveEntry)
      .filter((entry) => entry.visible !== 'always')
      .map((entry) => [entry.id, entry.visible]);

    expect(guarded.sort()).toEqual(
      [
        ['alerts-and-notifications', 'alert-rules-or-rating-access'],
        ['business-identity', 'business-identity-access'],
        ['commission-overrides', 'commission-plans-access'],
        ['commission-plans', 'commission-plans-access'],
        ['imported-refunds', 'imported-refunds-access'],
        ['invitations', 'invitations-owner'],
        ['leave-history-report', 'leave-report-access'],
        ['ratings-and-reviews', 'ratings-access'],
        ['staff-app-columns', 'staff-app-columns-access'],
        ['staff-app-link', 'employee-app-link-access'],
      ].sort(),
    );

    const counted = NAVIGATION_PAGES.filter((entry) => entry.count !== undefined).map((entry) => [
      entry.id,
      entry.count,
    ]);
    expect(counted.sort()).toEqual(
      [
        ['approvals-inbox', 'approvals-inbox'],
        ['attendance-exceptions', 'attendance-exceptions'],
        ['attendance-requests', 'attendance-requests'],
        ['leave-approvals', 'leave-approvals'],
      ].sort(),
    );
  });
});

describe('navigation Soon-entry filtering boundaries', () => {
  it('keeps the unified owner dashboard distinct from company reports', () => {
    expect(requiredPageById('all-businesses-dashboard')).toMatchObject({
      state: 'soon',
      roles: ['owner', 'general_manager'],
    });
  });

  it('applies business-type, country and role boundaries for Soon and planned entries', () => {
    const kitchen = requiredPageById('kitchen-screens');
    const stockItems = requiredPageById('stock-items');
    const qayd = requiredPageById('qayd-filing-pack');
    const zatca = requiredPageById('zatca-e-invoicing');
    const billing = requiredPageById('subscription-and-billing');
    const appearance = requiredPageById('appearance');
    const scheduleSettings = requiredPageById('schedule-settings');

    expect(isEntryShownForWorkspace(kitchen, 'restaurant', 'KW')).toBe(true);
    expect(isEntryShownForWorkspace(kitchen, 'salon', 'KW')).toBe(false);
    // NAV-Q19: stock entries show for every business type.
    expect(isEntryShownForWorkspace(stockItems, 'clinic', 'KW')).toBe(true);
    expect(isEntryShownForWorkspace(qayd, 'salon', 'KW')).toBe(true);
    expect(isEntryShownForWorkspace(qayd, 'salon', 'SA')).toBe(false);
    expect(isEntryShownForWorkspace(qayd, 'salon', 'AE')).toBe(false);
    expect(isEntryShownForWorkspace(qayd, 'salon', null)).toBe(false);
    expect(isEntryShownForWorkspace(zatca, 'salon', 'SA')).toBe(true);
    expect(isEntryShownForWorkspace(zatca, 'salon', 'KW')).toBe(false);

    expect(billing.state).toBe('soon');
    if (billing.state === 'soon') {
      expect(isSoonEntryShownForRole(billing, 'owner')).toBe(true);
      expect(isSoonEntryShownForRole(billing, 'cashier')).toBe(false);
      expect(isSoonEntryShownForRole(billing, 'general_manager')).toBe(false);
      expect(isSoonEntryShownForRole(billing, 'custom_admin')).toBe(false);
    }

    expect(appearance).toMatchObject({ state: 'live', route: '/appearance', visible: 'always' });
    expect(isEntryShownForWorkspace(appearance, null, null)).toBe(true);
    expect(pageEntryHref(appearance)).toBe('/appearance');

    expect(pageEntryHref(scheduleSettings)).toBe('/schedules/settings');
    expect(resolveMenuEntryForPathname('/schedules/settings')?.id).toBe('schedule-settings');
    expect(resolveMenuEntryForPathname('/schedules')?.id).toBe('weekly-schedules');
    expect(parseNavigationStyle('A')).toBe('A');
    expect(parseNavigationStyle('invalid')).toBe(DEFAULT_NAVIGATION_STYLE);
    expect(DEFAULT_NAVIGATION_STYLE).toBe('C');
  });
});
