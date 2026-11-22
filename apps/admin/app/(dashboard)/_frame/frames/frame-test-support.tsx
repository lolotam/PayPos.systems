import { DirectionProvider } from '@pospay/ui';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { vi } from 'vitest';

import type { WorkspaceController } from '@/workspace/model/workspace-provider';

import { visiblePageIds, type VisibilityConditions } from '../menu/visible-page-ids';
import { NavStyleProvider } from '../nav-style/nav-style-context';
import { NAVIGATION_PAGES } from '../navigation-model';

const OPEN: VisibilityConditions = {
  always: true,
  'alert-rules-or-rating-access': true,
  'business-identity-access': true,
  'commission-plans-access': true,
  'employee-app-link-access': true,
  'imported-refunds-access': true,
  'leave-report-access': true,
  'staff-app-columns-access': true,
};

/** حالة قابلة للتعديل تقرؤها محاكيات الاختبار؛ كل ملف اختبار إطار يربطها بنفس الأسماء. */
export const frameState = {
  pathname: '/',
  locale: 'en' as 'en' | 'ar',
  visible: [] as readonly string[],
  push: vi.fn(),
  workspace: undefined as WorkspaceController | undefined,
};

export const navigationMock = {
  usePathname: () => frameState.pathname,
  useRouter: () => ({ push: frameState.push, refresh: () => undefined }),
};
export const localeMock = {
  useLocale: () => frameState.locale,
  useLocaleController: () => ({ locale: frameState.locale, setLocale: () => undefined }),
};
export const visibleMock = { useVisiblePageIds: () => frameState.visible };
export const workspaceMock = { useWorkspace: () => frameState.workspace };
export const sessionMock = {
  useSessionAccount: () => ({ id: 'user-1', name: 'Sara Ali', email: 'sara@example.test' }),
};
export const signOutMock = {
  useSignOut: () => ({ pending: false, failed: false, submit: () => Promise.resolve() }),
};
export const bellMock = {
  NotificationBell: () => <button type="button">Notifications</button>,
};
export const localeSwitchMock = {
  LocaleSwitch: () => <button type="button">Switch language</button>,
};

const COMPANY = {
  id: 'company-1',
  name_ar: null,
  name_en: 'Synthetic company',
  role_code: 'owner',
  scope: 'COMPANY' as const,
};

/** يضبط النشاط المحدد ويحسب الصفحات المرئية لمالك في الكويت بكل الشروط مفتوحة. */
export function selectBusiness(businessType: 'salon' | 'restaurant'): void {
  const business = {
    id: 'business-1',
    name_ar: null,
    name_en: 'Synthetic business',
    business_type: businessType,
    country: 'KW' as const,
    branches: [],
  };
  const branch = {
    id: 'branch-1',
    name_ar: null,
    name_en: 'Main branch',
    effective_timezone: 'Asia/Kuwait',
    is_active: true,
  };
  frameState.workspace = {
    status: 'ready',
    company: { ...COMPANY, businesses: [business] },
    business,
    branch,
    companies: [{ ...COMPANY, businesses: [business] }],
    choose: vi.fn(),
  };
  frameState.visible = visiblePageIds(NAVIGATION_PAGES, {
    conditions: OPEN,
    businessType,
    country: 'KW',
    role: 'owner',
  });
}

/** يضبط عرض الشاشة لاستعلامات matchMedia التي تستخدمها أجزاء @pospay/ui. */
export function stubViewport(width: number): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: [...query.matchAll(/\(([^)]+)\)/g)].every(([, rule = '']) => {
      const below = /^width < (\d+)px$/.exec(rule);
      const min = /^min-width: (\d+)px$/.exec(rule);
      const range = /^(\d+)px <= width < (\d+)px$/.exec(rule);
      if (below) return width < Number(below[1]);
      if (min) return width >= Number(min[1]);
      return range ? width >= Number(range[1]) && width < Number(range[2]) : false;
    }),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function wrap(ui: ReactElement, dir: 'ltr' | 'rtl') {
  return (
    <DirectionProvider dir={dir}>
      <NavStyleProvider initialStyle="C">{ui}</NavStyleProvider>
    </DirectionProvider>
  );
}

export function renderFrame(ui: ReactElement, dir: 'ltr' | 'rtl' = 'ltr') {
  const result = render(wrap(ui, dir));
  return { ...result, rerenderFrame: (next: ReactElement) => result.rerender(wrap(next, dir)) };
}

export function resetFrameState(): void {
  frameState.pathname = '/';
  frameState.locale = 'en';
  frameState.push.mockReset();
  vi.unstubAllGlobals();
  selectBusiness('restaurant');
}
