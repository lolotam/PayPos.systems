import type { NavigationPageEntry } from '@/workspace/nav-types';

/** مدخل هوية النشاط تحت قسم الإعداد. */
export const BUSINESS_IDENTITY_NAV_PAGES: readonly NavigationPageEntry[] = [
  {
    id: 'business-identity',
    route: '/business-identity',
    labelKey: 'businessIdentity.title',
    icon: 'Building2',
    visible: 'business-identity-access',
    state: 'live',
    section: 'setup',
    submenu: 'business',
    businessTypes: [],
    appMapEntry: true,
  },
];
