import { DirectionProvider } from '@pospay/ui';
import { act, render } from '@testing-library/react';
import { useMemo, useSyncExternalStore, type ReactElement } from 'react';
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
  'ratings-access': true,
  'staff-app-columns-access': true,
};

// قراءة التقييمات للمديرين الأربعة فقط في الواقع، فأي دور تاني في الاختبار ما يشوفش صفحتها.
const RATINGS_ROLES: readonly string[] = [
  'owner',
  'general_manager',
  'business_manager',
  'branch_manager',
];

const listeners = new Set<() => void>();

function setPathname(path: string): void {
  const [address = '', fragment] = path.split('#');
  const [pathname = '', search = ''] = address.split('?');
  frameState.pathname = pathname;
  frameState.search = search;
  const hash = fragment === undefined ? '' : `#${fragment}`;
  window.history.replaceState(null, '', window.location.pathname + hash);
  for (const listener of listeners) listener();
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** حالة قابلة للتعديل تقرؤها محاكيات الاختبار؛ كل ملف اختبار إطار يربطها بنفس الأسماء. */
export const frameState = {
  pathname: '/',
  search: '',
  locale: 'en' as 'en' | 'ar',
  visible: [] as readonly string[],
  push: vi.fn(setPathname),
  replace: vi.fn(setPathname),
  params: {} as Record<string, string>,
  settled: true,
  workspace: undefined as WorkspaceController | undefined,
};

/** يغيّر المسار كأنه انتقال مكتمل (أمامًا أو رجوعًا) والإطار باقٍ مركّبًا. */
export function goTo(path: string): void {
  act(() => setPathname(path));
}

function useExternal<T>(read: () => T): T {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    read,
    read,
  );
}

/** ما يرميه `notFound()` المحاكى؛ يلتقطه `NotFoundProbe` فيرسم «Not found». */
export const NOT_FOUND_MESSAGE = 'NEXT_NOT_FOUND';

// موجّه Next الحقيقي ثابت الهوية بين الرسمات، فالمحاكي كذلك حتى لا يعيد تأثيرٌ يعتمد عليه تشغيل نفسه.
const stableRouter = {
  push: (...args: Parameters<typeof frameState.push>) => frameState.push(...args),
  replace: (...args: Parameters<typeof frameState.replace>) => frameState.replace(...args),
  refresh: () => undefined,
};

export const navigationMock = {
  usePathname: () => useExternal(() => frameState.pathname),
  useSearchParams: () => {
    const search = useExternal(() => frameState.search);
    return useMemo(() => new URLSearchParams(search), [search]);
  },
  useRouter: () => stableRouter,
  useParams: () => frameState.params,
  notFound: (): never => {
    throw new Error(NOT_FOUND_MESSAGE);
  },
};
export const localeMock = {
  useLocale: () => frameState.locale,
  useLocaleController: () => ({ locale: frameState.locale, setLocale: () => undefined }),
};
export const visibleMock = { useVisiblePageIds: () => frameState.visible };
/** هل استقرت قراءات الظهور؛ الاختبارات التي لا تهمها هذه القراءات تتركها true. */
export const settledMock = { useVisibilitySettled: () => frameState.settled };
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

/** يضبط النشاط المحدد ويحسب الصفحات المرئية لدور (المالك افتراضيًا) في الكويت بكل الشروط مفتوحة. */
export function selectBusiness(
  businessType: 'salon' | 'restaurant',
  role = COMPANY.role_code,
): void {
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
    company: { ...COMPANY, role_code: role, businesses: [business] },
    business,
    branch,
    companies: [{ ...COMPANY, role_code: role, businesses: [business] }],
    choose: vi.fn(),
  };
  frameState.visible = visiblePageIds(NAVIGATION_PAGES, {
    conditions: { ...OPEN, 'ratings-access': RATINGS_ROLES.includes(role) },
    businessType,
    country: 'KW',
    role,
  });
}

const mediaListeners = new Set<() => void>();

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
    addEventListener: (_type: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => mediaListeners.delete(listener),
  }));
}

/** يغيّر عرض الشاشة والإطار مركّب، ويُعلم من يراقب matchMedia كما يفعل المتصفح. */
export function resizeTo(width: number): void {
  stubViewport(width);
  act(() => {
    for (const listener of mediaListeners) listener();
  });
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
  frameState.search = '';
  window.history.replaceState(null, '', window.location.pathname);
  frameState.locale = 'en';
  frameState.params = {};
  frameState.settled = true;
  frameState.push.mockReset();
  frameState.push.mockImplementation(setPathname);
  frameState.replace.mockReset();
  frameState.replace.mockImplementation(setPathname);
  vi.unstubAllGlobals();
  selectBusiness('restaurant');
}
