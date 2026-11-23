import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppearanceRoute } from './appearance-route';
import {
  enterWorkspace,
  leaveWorkspace,
  renderDashboard,
  resetDashboardState,
  visibleStyles,
} from './dashboard-test-support';
import { sessionState } from './dashboard-mocks';
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
const page = (body = 'Page body') => <CurrentRoute>{body}</CurrentRoute>;

function openAccountMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') }), {
    key: 'Enter',
  });
  return screen.getByRole('menu');
}

function chooseStyleCard(style: 'A' | 'B' | 'C') {
  const name = label(`adminNav.style${style}Label` as const);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`${name}$`) }));
}

beforeEach(() => {
  resetFrameState();
  resetDashboardState();
  stubViewport(1280);
});

describe('the frame the dashboard draws', () => {
  it.each(['A', 'B', 'C'] as const)('draws only frame %s around the page', (style) => {
    renderDashboard(page(), style);
    expect(visibleStyles()).toEqual([style]);
    expect(within(screen.getByRole('main')).getByText('Page body')).toBeTruthy();
  });

  it('marks the page the user is on in style A', () => {
    frameState.pathname = '/staff/import';
    renderDashboard(page(), 'A');
    const sidebar = screen.getByRole('complementary');
    expect(
      within(sidebar)
        .getByRole('link', { name: label('adminNav.groupATeam') })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('marks the page the user is on in style B', () => {
    frameState.pathname = '/staff/import';
    renderDashboard(page(), 'B');
    const bar = screen.getByRole('navigation', { name: label('shell.navigation') });
    expect(
      within(bar)
        .getByRole('button', { name: new RegExp(`^${label('adminNav.moduleBPeople')}`) })
        .getAttribute('aria-current'),
    ).toBe('page');
  });

  it('marks the page the user is on in style C', () => {
    frameState.pathname = '/staff/import';
    renderDashboard(page(), 'C');
    const team = screen.getByRole('button', {
      name: new RegExp(`^${label('adminNav.workspaceCTeam')}`),
    });
    expect(team.getAttribute('aria-label')).toContain(label('adminNav.currentStyleBadge'));
  });
});

describe('switching the style', () => {
  it('changes the frame from the Appearance page and keeps the address, with no reload', () => {
    frameState.pathname = '/appearance';
    renderDashboard(
      <CurrentRoute>
        <AppearanceRoute />
      </CurrentRoute>,
    );
    expect(visibleStyles()).toEqual(['C']);
    chooseStyleCard('A');
    expect(visibleStyles()).toEqual(['A']);
    expect(screen.getByText('Route: /appearance')).toBeTruthy();
    expect(frameState.push).not.toHaveBeenCalled();
    expect(frameState.replace).not.toHaveBeenCalled();
    expect(document.cookie).toContain('pospay_nav_style=A');
  });

  it('changes the frame from the account menu and keeps the address', () => {
    frameState.pathname = '/staff';
    renderDashboard(page(), 'B');
    const styleC = within(openAccountMenu()).getByRole('menuitem', {
      name: new RegExp(label('adminNav.styleCLabel')),
    });
    fireEvent.click(styleC);
    expect(visibleStyles()).toEqual(['C']);
    expect(screen.getByText('Route: /staff')).toBeTruthy();
    expect(frameState.push).not.toHaveBeenCalled();
    expect(document.cookie).toContain('pospay_nav_style=C');
  });
});

describe('a user who has no workspace to work in', () => {
  it.each(['loading', 'empty', 'error', 'choose'] as const)(
    'opens Appearance and switches the style when the workspace is %s',
    (status) => {
      leaveWorkspace(status);
      frameState.pathname = '/appearance';
      renderDashboard(<AppearanceRoute />);
      expect(screen.getByRole('heading', { level: 1, name: label('adminNav.appearanceTitle') })).toBeTruthy();
      chooseStyleCard('B');
      expect(visibleStyles()).toEqual(['B']);
      expect(screen.getByRole('heading', { level: 1, name: label('adminNav.appearanceTitle') })).toBeTruthy();
    },
  );

  it('opens Appearance for a role with no page of its own', () => {
    enterWorkspace('salon', 'custom_admin');
    frameState.pathname = '/appearance';
    renderDashboard(<AppearanceRoute />);
    expect(screen.getByRole('heading', { level: 1, name: label('adminNav.appearanceTitle') })).toBeTruthy();
  });

  it('still holds back every other page until the workspace is ready', () => {
    leaveWorkspace('loading');
    frameState.pathname = '/staff';
    renderDashboard(page());
    expect(screen.getByRole('status').textContent).toBe(label('admin.loading'));
    expect(screen.queryByText('Page body')).toBeNull();
  });

  it('asks for a business instead of the page when none is chosen', () => {
    leaveWorkspace('choose');
    frameState.pathname = '/staff';
    renderDashboard(page());
    expect(screen.getByText(label('admin.choosePrompt'))).toBeTruthy();
    expect(screen.queryByText('Page body')).toBeNull();
  });
});

describe('what stays as it was on main', () => {
  it('lets the customer packages page open with a linked workspace that is not chosen', () => {
    leaveWorkspace('choose');
    frameState.pathname = '/orders/customers/customer-1/packages';
    renderDashboard(page());
    expect(screen.getByText('Page body')).toBeTruthy();
  });

  it('shows the session error above the page without hiding the page', () => {
    sessionState.isError = true;
    renderDashboard(page());
    expect(screen.getByRole('alert').textContent).toContain(label('admin.unexpected'));
    expect(screen.getByText('Page body')).toBeTruthy();
  });

  it('shows no alert when the session reads fine', () => {
    renderDashboard(page());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
