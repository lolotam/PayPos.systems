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

const COMPANY_REPORTS: readonly [NavigationRoleCode, ...NavigationRoleCode[]] = [
  'owner',
  'general_manager',
  'accountant',
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
    labelKey: 'adminNavPages.approvalsInbox',
    descriptionKey: 'adminNav.approvalsInboxLead',
    icon: 'Inbox',
    state: 'soon',
    plannedRoute: '/approvals',
    count: 'approvals-inbox',
    section: 'home',
    submenu: 'home',
    businessTypes: [],
    roles: OPS_MANAGERS,
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
    roles: COMPANY_REPORTS,
    appMapEntry: true,
  },
];
