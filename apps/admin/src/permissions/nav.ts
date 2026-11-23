import type { NavigationPageEntry, NavigationRoleCode } from '@/workspace/nav-types';

const COMPANY_MANAGERS: readonly [NavigationRoleCode, ...NavigationRoleCode[]] = [
  'owner',
  'general_manager',
];

const BIZ_MANAGERS: readonly [NavigationRoleCode, ...NavigationRoleCode[]] = [
  'owner',
  'general_manager',
  'business_manager',
];

/** مداخل الصلاحيات والوصول تحت قسم الإعداد. */
export const PERMISSIONS_NAV_PAGES: readonly NavigationPageEntry[] = [
  {
    id: 'permissions',
    route: '/permissions',
    labelKey: 'permissions.title',
    descriptionKey: 'shell.permissionsLead',
    icon: 'ShieldCheck',
    visible: 'always',
    state: 'live',
    section: 'setup',
    submenu: 'access',
    businessTypes: [],
    appMapEntry: true,
  },
  {
    id: 'invitations',
    route: '/invitations',
    labelKey: 'adminNavPages.invitations',
    icon: 'UserRound',
    state: 'live',
    visible: 'invitations-owner',
    formerSoonId: 'invitations',
    section: 'setup',
    submenu: 'access',
    businessTypes: [],
    appMapEntry: true,
  },
  {
    id: 'approval-limits',
    labelKey: 'adminNavPages.approvalLimits',
    icon: 'ShieldCheck',
    state: 'soon',
    section: 'setup',
    submenu: 'access',
    businessTypes: [],
    roles: BIZ_MANAGERS,
    appMapEntry: true,
  },
  {
    id: 'activity-log',
    labelKey: 'adminNavPages.activityLog',
    icon: 'Clock3',
    state: 'soon',
    section: 'setup',
    submenu: 'access',
    businessTypes: [],
    roles: COMPANY_MANAGERS,
    appMapEntry: true,
  },
];
