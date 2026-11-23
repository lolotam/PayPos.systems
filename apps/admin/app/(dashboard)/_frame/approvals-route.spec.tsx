import { t } from '@pospay/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalsRoute } from './approvals-route';
import { enterWorkspace, renderDashboard, resetDashboardState } from './dashboard-test-support';
import { frameState, resetFrameState, stubViewport } from './frames/frame-test-support';
import { NotFoundProbe } from './frames/not-found-probe';

const inbox = vi.hoisted(() => ({
  value: {
    kinds: [] as { id: string; label: string; href: string }[],
    state: 'settled' as 'loading' | 'failed' | 'settled',
  },
}));

vi.mock('./menu/use-approval-kinds', () => ({ useApprovalInbox: () => inbox.value }));
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
const main = () => within(screen.getByRole('main'));

beforeEach(() => {
  resetFrameState();
  resetDashboardState();
  stubViewport(1280);
  frameState.pathname = '/approvals';
  inbox.value = { kinds: [], state: 'settled' };
});

describe('the Approvals inbox route', () => {
  it('lists each kind the user may see and links to its page', () => {
    inbox.value = {
      state: 'settled',
      kinds: [
        { id: 'leave-approvals', label: 'Leave approvals', href: '/leave' },
        { id: 'attendance-requests', label: 'Attendance requests', href: '/staff/attendance-requests' },
      ],
    };
    renderDashboard(<ApprovalsRoute />);
    expect(
      main().getByRole('heading', { level: 1, name: label('adminNavPages.approvalsInbox') }),
    ).toBeTruthy();
    expect(main().getByRole('link', { name: 'Leave approvals' }).getAttribute('href')).toBe('/leave');
    expect(
      main().getByRole('link', { name: 'Attendance requests' }).getAttribute('href'),
    ).toBe('/staff/attendance-requests');
    expect(main().queryByRole('link', { name: 'Attendance exceptions' })).toBeNull();
  });

  it('says no list is available when the user may see no kind', () => {
    renderDashboard(<ApprovalsRoute />);
    expect(main().getByText(label('adminNav.approvalsInboxEmpty'))).toBeTruthy();
    expect(main().queryAllByRole('link')).toHaveLength(0);
  });

  it('says so when the kinds could not be checked', () => {
    inbox.value = { kinds: [], state: 'failed' };
    renderDashboard(<ApprovalsRoute />);
    expect(main().getByRole('alert').textContent).toBe(label('adminNav.approvalsInboxFailed'));
  });

  it('marks the Approvals entry current in the menu', () => {
    renderDashboard(<ApprovalsRoute />, 'A');
    const sidebar = within(screen.getByRole('complementary'));
    expect(
      sidebar.getByRole('link', { name: label('adminNav.groupAHome') }).getAttribute('aria-current'),
    ).toBe('page');
  });
});

describe('the Approvals inbox by its direct address', () => {
  it.each(['owner', 'general_manager', 'business_manager', 'branch_manager'])(
    'opens for the %s',
    (role) => {
      enterWorkspace('salon', role);
      renderDashboard(
        <NotFoundProbe>
          <ApprovalsRoute />
        </NotFoundProbe>,
      );
      expect(
        main().getByRole('heading', { level: 1, name: label('adminNavPages.approvalsInbox') }),
      ).toBeTruthy();
    },
  );

  it.each(['cashier', 'accountant', 'viewer', 'custom_admin'])(
    'shows not found to the %s, as the menu and the Soon address do',
    (role) => {
      enterWorkspace('salon', role);
      renderDashboard(
        <NotFoundProbe>
          <ApprovalsRoute />
        </NotFoundProbe>,
      );
      expect(screen.getByText('Not found')).toBeTruthy();
      expect(screen.queryByRole('heading', { name: label('adminNavPages.approvalsInbox') })).toBeNull();
    },
  );
});

