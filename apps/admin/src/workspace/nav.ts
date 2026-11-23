import type { NavigationPageEntry, NavigationRoleCode } from './nav-types';

const OPS_MANAGERS: readonly [NavigationRoleCode, ...NavigationRoleCode[]] = [
  'owner',
  'general_manager',
  'business_manager',
  'branch_manager',
];

const OPS_REPORTS: readonly [NavigationRoleCode, ...NavigationRoleCode[]] = [
  'owner',
  'general_manager',
  'accountant',
  'business_manager',
  'branch_manager',
  'viewer',
];

/** مداخل قسم الرئيسية (Home) في منطقة الإدارة. */
export const WORKSPACE_NAV_PAGES: readonly NavigationPageEntry[] = [
  {
    id: 'dashboard',
    route: '/',
    labelKey: 'admin.homeTitle',
    descriptionKey: 'shell.workspaceLead',
    icon: 'House',
    visible: 'always',
    state: 'live',
    section: 'home',
    submenu: 'home',
    businessTypes: [],
    appMapEntry: true,
  },
  {
    id: 'shift-dashboard',
    labelKey: 'adminNavPages.shiftDashboard',
    icon: 'Clock3',
    state: 'soon',
    section: 'home',
    submenu: 'home',
    businessTypes: [],
    roles: OPS_MANAGERS,
    appMapEntry: true,
  },
  {
    id: 'approvals-inbox',
    route: '/approvals',
    formerSoonId: 'approvals-inbox',
    labelKey: 'adminNavPages.approvalsInbox',
    descriptionKey: 'adminNav.approvalsInboxLead',
    icon: 'Inbox',
    visible: 'always',
    state: 'live',
    count: 'approvals-inbox',
    section: 'home',
    submenu: 'home',
    businessTypes: [],
    appMapEntry: true,
  },
  {
    id: 'daily-sales-dashboard',
    labelKey: 'adminNavPages.dailySalesDashboard',
    icon: 'Store',
    state: 'soon',
    section: 'home',
    submenu: 'home',
    businessTypes: [],
    roles: OPS_REPORTS,
    appMapEntry: true,
  },
  {
    id: 'all-businesses-dashboard',
    labelKey: 'adminNavPages.allBusinessesDashboard',
    icon: 'Building2',
    state: 'soon',
    section: 'home',
    submenu: 'home',
    businessTypes: [],
    roles: ['owner', 'general_manager'],
    appMapEntry: true,
  },
];
