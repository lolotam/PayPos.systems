import { t } from '@pospay/i18n';
import { screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';

import type { NavigationStyle } from '@/workspace/nav-types';

import { DashboardFrame } from './dashboard-frame';
import { sessionState } from './dashboard-mocks';
import { frameState, renderFrame, selectBusiness } from './frames/frame-test-support';
import { NavStyleProvider } from './nav-style/nav-style-context';

const label = (key: Parameters<typeof t>[1]) => t('en', key);

export function resetDashboardState(): void {
  sessionState.isError = false;
}

type NotReady = 'loading' | 'empty' | 'error' | 'choose';

/** مستخدم بلا مساحة عمل جاهزة: لا نشاط ولا دور، فتبقى قوائمه ما لا يحتاج نشاطًا (المظهر والرئيسية). */
export function leaveWorkspace(status: NotReady): void {
  const shared = { companies: [], choose: vi.fn() };
  frameState.workspace =
    status === 'error' ? { ...shared, status, message: 'Could not read' } : { ...shared, status };
  frameState.visible = ['dashboard', 'appearance', 'sign-in-security'];
}

/** يعيد مساحة جاهزة بدور محدد وكل الصفحات المرئية له. */
export function enterWorkspace(businessType: 'salon' | 'restaurant', role?: string): void {
  selectBusiness(businessType, role);
}

/** يرسم صفحة داخل `DashboardFrame` بنمط ابتدائي محدد، كما يفعل غلاف لوحة الإدارة. */
export function renderDashboard(page: ReactNode, style: NavigationStyle = 'C') {
  const wrap = (content: ReactNode) => (
    <NavStyleProvider initialStyle={style}>
      <DashboardFrame>{content}</DashboardFrame>
    </NavStyleProvider>
  );
  const result = renderFrame(wrap(page));
  return { ...result, rerenderDashboard: (next: ReactNode) => result.rerenderFrame(wrap(next)) };
}

/** الأنماط التي يراها المستخدم الآن بعلامة كل إطار: الطيّ في A، ووحدة «اليوم» في شريط B، وباحث الصفحات في لوحة C. */
export function visibleStyles(): NavigationStyle[] {
  const marks: [NavigationStyle, boolean][] = [
    ['A', screen.queryByRole('button', { name: label('adminNav.collapseNavigation') }) !== null],
    ['B', screen.queryByRole('button', { name: new RegExp(`^${label('adminNav.moduleBToday')}`) }) !== null],
    ['C', screen.queryByRole('button', { name: label('adminNav.pageFinderLabel') }) !== null],
  ];
  return marks.filter(([, present]) => present).map(([style]) => style);
}
