import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { leaveWorkspace, renderDashboard, resetDashboardState } from './dashboard-test-support';
import { frameState, resetFrameState, stubViewport } from './frames/frame-test-support';
import { NotFoundProbe } from './frames/not-found-probe';
import { OverviewRoute } from './overview-route';

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
  './menu/use-visibility-settled',
  async () => (await import('./frames/frame-test-support')).settledMock,
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
const route = (group: string) => {
  frameState.pathname = `/overview/${group}`;
  frameState.params = { group };
  return (
    <NotFoundProbe>
      <OverviewRoute />
    </NotFoundProbe>
  );
};

beforeEach(() => {
  resetFrameState();
  resetDashboardState();
  stubViewport(1280);
});

describe('/overview/<group>', () => {
  it('shows the overview of a group that belongs to the current style', () => {
    renderDashboard(route('team'), 'C');
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('heading', { level: 1, name: label('adminNav.workspaceCTeam') })).toBeTruthy();
    expect(main.getByRole('link', { name: /Import employees/ })).toBeTruthy();
    expect(frameState.replace).not.toHaveBeenCalled();
  });

  it('replaces the address of a group that only another style has with its first visible page', () => {
    renderDashboard(route('sell'), 'C');
    expect(frameState.replace).toHaveBeenCalledTimes(1);
    expect(frameState.pathname).not.toBe('/overview/sell');
    expect(frameState.pathname).not.toBe('/');
    expect(screen.queryByText('Not found')).toBeNull();
  });

  it('sends an unknown group to Home without showing not found', () => {
    renderDashboard(route('no-such-group'), 'C');
    expect(frameState.replace).toHaveBeenCalledWith('/');
    expect(screen.queryByText('Not found')).toBeNull();
  });

  it('sends a group with nothing visible to Home', () => {
    frameState.visible = ['dashboard'];
    renderDashboard(route('team'), 'C');
    expect(frameState.replace).toHaveBeenCalledWith('/');
  });

  it('waits while the workspace loads: loading status, no redirect, no not found', () => {
    leaveWorkspace('loading');
    renderDashboard(route('team'), 'C');
    expect(screen.getByRole('status').textContent).toBe(label('admin.loading'));
    expect(frameState.replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Not found')).toBeNull();
  });

  it('follows a style switch made on an overview only the old style has', () => {
    renderDashboard(route('sell'), 'B');
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        level: 1,
        name: label('adminNav.moduleBSell'),
      }),
    ).toBeTruthy();
    expect(frameState.replace).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') }), {
      key: 'Enter',
    });
    fireEvent.click(
      within(screen.getByRole('menu')).getByRole('menuitem', {
        name: new RegExp(label('adminNav.styleCLabel')),
      }),
    );
    expect(frameState.replace).toHaveBeenCalledTimes(1);
    expect(frameState.pathname).not.toBe('/overview/sell');
    expect(screen.getByRole('button', { name: label('adminNav.pageFinderLabel') })).toBeTruthy();
  });
});
