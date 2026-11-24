import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { leaveWorkspace, renderDashboard, resetDashboardState } from './dashboard-test-support';
import { frameState, resetFrameState, stubViewport } from './frames/frame-test-support';
import { TwoFactorRoute } from './two-factor-route';

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

beforeEach(() => {
  resetFrameState();
  resetDashboardState();
  stubViewport(1280);
  frameState.pathname = '/security/two-factor';
});

describe('the Authenticator page inside the frame', () => {
  it('asks for the password first, drawn inside the page area of the frame', () => {
    renderDashboard(<TwoFactorRoute />);
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('heading', { level: 1, name: label('admin.enrolTitle') })).toBeTruthy();
    expect(main.getByText(label('admin.enrolPasswordLead'))).toBeTruthy();
    expect(main.getByLabelText(label('admin.passwordLabel'))).toBeTruthy();
  });

  it('marks its entry current in the account menu', () => {
    renderDashboard(<TwoFactorRoute />);
    fireEvent.keyDown(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') }), {
      key: 'Enter',
    });
    const entry = within(screen.getByRole('menu')).getByRole('menuitem', {
      name: new RegExp(label('admin.enrolLink')),
    });
    expect(entry.textContent).toContain(label('adminNav.currentStyleBadge'));
  });

  it('marks its entry current in the navigation too', () => {
    renderDashboard(<TwoFactorRoute />, 'A');
    const sidebar = within(screen.getByRole('complementary'));
    expect(
      sidebar.getByRole('link', { name: label('adminNav.groupASetup') }).getAttribute('aria-current'),
    ).toBe('page');
  });

  it('opens for a user whose workspace is not ready', () => {
    leaveWorkspace('empty');
    renderDashboard(<TwoFactorRoute />);
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        level: 1,
        name: label('admin.enrolTitle'),
      }),
    ).toBeTruthy();
  });
});
