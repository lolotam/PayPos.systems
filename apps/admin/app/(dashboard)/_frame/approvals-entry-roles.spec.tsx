import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enterWorkspace, renderDashboard, resetDashboardState } from './dashboard-test-support';
import { CurrentRoute } from './frames/current-route';
import { frameState, resetFrameState, stubViewport } from './frames/frame-test-support';

vi.mock('next/navigation', async () => (await import('./frames/frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('./frames/frame-test-support')).localeMock,
);
vi.mock(
  './menu/use-visible-page-ids',
  async () => (await import('./frames/frame-test-support')).visibleMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./dashboard-mocks')).dashboardWorkspaceMock,
);
vi.mock(
  '@/session/api/use-session',
  async () => (await import('./dashboard-mocks')).dashboardSessionMock,
);
vi.mock(
  '@/session/api/use-sign-out',
  async () => (await import('./frames/frame-test-support')).signOutMock,
);
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('./frames/frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('./frames/frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);
const MANAGERS = ['owner', 'general_manager', 'business_manager', 'branch_manager'];
const OTHERS = ['accountant', 'shift_supervisor', 'cashier', 'storekeeper', 'viewer', 'custom_admin'];
const entry = () =>
  screen.queryAllByRole('link', { name: new RegExp(label('adminNavPages.approvalsInbox')) });

beforeEach(() => {
  resetFrameState();
  resetDashboardState();
  stubViewport(1280);
  frameState.pathname = '/';
});

describe.each(['A', 'B', 'C'] as const)('the Approvals inbox entry in style %s', (style) => {
  it.each(MANAGERS)('is in the menu for the %s', (role) => {
    enterWorkspace('salon', role);
    renderDashboard(<CurrentRoute>Page body</CurrentRoute>, style);
    expect(entry().length).toBeGreaterThan(0);
  });

  it.each(OTHERS)('is not in the menu for the %s', (role) => {
    enterWorkspace('salon', role);
    renderDashboard(<CurrentRoute>Page body</CurrentRoute>, style);
    expect(entry()).toHaveLength(0);
  });
});

describe('the Approvals inbox entry in the page finder and the old address', () => {
  const search = () => {
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.pageFinderLabel') }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'approvals' } });
    return within(screen.getByRole('dialog'));
  };

  it('is found by a manager', () => {
    enterWorkspace('salon', 'branch_manager');
    renderDashboard(<CurrentRoute>Page body</CurrentRoute>, 'C');
    expect(search().getByRole('link', { name: /Approvals inbox/ })).toBeTruthy();
  });

  it.each(OTHERS)('is not found by the %s', (role) => {
    enterWorkspace('salon', role);
    renderDashboard(<CurrentRoute>Page body</CurrentRoute>, 'C');
    expect(search().queryByRole('link', { name: /Approvals inbox/ })).toBeNull();
  });
});
