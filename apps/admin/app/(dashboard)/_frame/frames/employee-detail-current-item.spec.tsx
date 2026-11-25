import { t } from '@pospay/i18n';
import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { frameState, renderFrame, resetFrameState, stubViewport } from './frame-test-support';
import { StyleAFrame } from './style-a-frame';
import { StyleBFrame } from './style-b-frame';
import { StyleCFrame } from './style-c-frame';

vi.mock('next/navigation', async () => (await import('./frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('./frame-test-support')).localeMock,
);
vi.mock(
  '../menu/use-visible-page-ids',
  async () => (await import('./frame-test-support')).visibleMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./frame-test-support')).workspaceMock,
);
vi.mock('@/session/api/use-session', async () => (await import('./frame-test-support')).sessionMock);
vi.mock(
  '@/session/api/use-sign-out',
  async () => (await import('./frame-test-support')).signOutMock,
);
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('./frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('./frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);
const EMPLOYEE = '01920000-0000-7000-8000-0000000000a2';
const ADDRESSES = [
  [`/staff/${EMPLOYEE}`, ''],
  [`/staff/${EMPLOYEE}`, 'tab=pay'],
  [`/staff/${EMPLOYEE}`, 'tab=hours'],
  [`/staff/${EMPLOYEE}`, 'tab=documents'],
  [`/staff/${EMPLOYEE}/leave`, ''],
] as const;
const employeesLink = (scope: HTMLElement) =>
  within(scope).getByRole('link', { name: /^Employees/ });

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(ADDRESSES)('the employee page at %s?%s', (pathname, search) => {
  beforeEach(() => {
    frameState.pathname = pathname;
    frameState.search = search;
  });

  it('keeps Employees current in style A', () => {
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const tabs = screen.getByRole('navigation', { name: label('adminNav.tabsLabel') });
    const pills = screen.getByRole('navigation', { name: label('adminNav.pillsLabel') });
    expect(
      within(tabs).getByRole('link', { name: label('adminNav.submenuEmployees') }).getAttribute('aria-current'),
    ).toBe('page');
    expect(employeesLink(pills).getAttribute('aria-current')).toBe('page');
  });

  it('keeps Employees current in style B', () => {
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const list = screen.getByRole('navigation', { name: label('adminNav.localNavigation') });
    expect(employeesLink(list).getAttribute('aria-current')).toBe('page');
  });

  it('keeps Employees current in style C', () => {
    renderFrame(<StyleCFrame>Page body</StyleCFrame>);
    const panel = screen.getByRole('complementary', { name: label('adminNav.localNavigation') });
    expect(employeesLink(panel).getAttribute('aria-current')).toBe('page');
  });
});
