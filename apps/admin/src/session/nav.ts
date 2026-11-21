import type { NavigationPageEntry } from '@/workspace/nav-types';

/** مدخل أمان الدخول (تطبيق المصادقة) تحت قسم الإعداد. */
export const SESSION_NAV_PAGES: readonly NavigationPageEntry[] = [
  {
    id: 'sign-in-security',
    route: '/security/two-factor',
    labelKey: 'admin.enrolLink',
    descriptionKey: 'admin.enrolLead',
    icon: 'KeyRound',
    visible: 'always',
    state: 'live',
    section: 'setup',
    submenu: 'access',
    businessTypes: [],
    appMapEntry: true,
  },
];
