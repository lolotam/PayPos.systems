import type { NavigationPageEntry, NavigationRoleCode } from '@/workspace/nav-types';

const OWNER_ONLY: readonly [NavigationRoleCode, ...NavigationRoleCode[]] = ['owner'];

const FINANCE_ROLES: readonly [NavigationRoleCode, ...NavigationRoleCode[]] = [
  'owner',
  'general_manager',
  'accountant',
];

const FINANCE_BUSINESS: readonly [NavigationRoleCode, ...NavigationRoleCode[]] = [
  'owner',
  'general_manager',
  'accountant',
  'business_manager',
];

/** مداخل الرواتب والعمولات (Pay) تحت قسم الفريق. */
export const COMMISSIONS_NAV_PAGES: readonly NavigationPageEntry[] = [
  {
    id: 'commission-plans',
    route: '/commissions/plans',
    labelKey: 'commissionPlanBuilder.navTitle',
    icon: 'Star',
    visible: 'commission-plans-access',
    state: 'live',
    section: 'team',
    submenu: 'pay',
    businessTypes: [],
    appMapEntry: true,
  },
  {
    id: 'commission-overrides',
    route: '/commissions/overrides',
    labelKey: 'commissionOverrides.navTitle',
    icon: 'Star',
    visible: 'commission-plans-access',
    state: 'live',
    section: 'team',
    submenu: 'pay',
    businessTypes: [],
    appMapEntry: true,
  },
  {
    id: 'salaries',
    labelKey: 'adminNavPages.salaries',
    icon: 'Star',
    state: 'soon',
    section: 'team',
    submenu: 'pay',
    businessTypes: [],
    roles: OWNER_ONLY,
    appMapEntry: true,
  },
  {
    id: 'commission-statements',
    route: '/commissions/statements',
    formerSoonId: 'commission-statements',
    labelKey: 'adminNavPages.commissionStatements',
    icon: 'Star',
    visible: 'always',
    state: 'live',
    section: 'team',
    submenu: 'pay',
    businessTypes: [],
    roles: FINANCE_BUSINESS,
    appMapEntry: true,
  },
  {
    id: 'payroll-runs-and-payslips',
    labelKey: 'adminNavPages.payrollRunsAndPayslips',
    icon: 'Inbox',
    state: 'soon',
    section: 'team',
    submenu: 'pay',
    businessTypes: [],
    roles: FINANCE_ROLES,
    appMapEntry: true,
  },
  {
    id: 'loans-and-advances',
    labelKey: 'adminNavPages.loansAndAdvances',
    icon: 'Inbox',
    state: 'soon',
    section: 'team',
    submenu: 'pay',
    businessTypes: [],
    roles: FINANCE_ROLES,
    appMapEntry: true,
  },
];
