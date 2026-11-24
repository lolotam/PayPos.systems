import { t } from '@pospay/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearNavStyleCookie } from '@/shared/nav-style/nav-style-cookie';

import { renderDashboard, resetDashboardState } from './dashboard-test-support';
import { frameState, resetFrameState, stubViewport } from './frames/frame-test-support';
import { TwoFactorRoute } from './two-factor-route';

const session = vi.hoisted(() => ({ signOutSession: vi.fn() }));
const page = vi.hoisted(() => ({ loadPage: vi.fn() }));

vi.mock('@/session/api/session-calls', () => session);
vi.mock('@/shared/browser/load-page', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadPage: (path: string) => page.loadPage(path),
}));
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
  '@/notifications/ui/notification-bell',
  async () => (await import('./frames/frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('./frames/frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);
const storedStyle = () =>
  document.cookie
    .split('; ')
    .find((pair) => pair.startsWith('pospay_nav_style='))
    ?.split('=')[1];

function signOutFromMenu() {
  fireEvent.keyDown(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') }), {
    key: 'Enter',
  });
  fireEvent.click(
    within(screen.getByRole('menu')).getByRole('menuitem', { name: label('admin.signOut') }),
  );
}

beforeEach(() => {
  resetFrameState();
  resetDashboardState();
  stubViewport(1280);
  session.signOutSession.mockReset();
  page.loadPage.mockReset();
  document.cookie = 'pospay_nav_style=B; Path=/';
});
afterEach(clearNavStyleCookie);

describe('a sign-out the server refused', () => {
  it.each(['A', 'B', 'C'] as const)(
    'is announced in an alert that stays after the menu closes, in style %s',
    async (style) => {
      session.signOutSession.mockResolvedValue(false);
      renderDashboard(<p>Page body</p>, style);
      expect(screen.queryByRole('alert')).toBeNull();
      signOutFromMenu();
      expect((await screen.findByRole('alert')).textContent).toBe(label('admin.unexpected'));
      expect(screen.queryByRole('menu')).toBeNull();
      expect(storedStyle()).toBe('B');
      expect(page.loadPage).not.toHaveBeenCalled();
    },
  );

  it('is announced on the Authenticator page too', async () => {
    frameState.pathname = '/security/two-factor';
    session.signOutSession.mockResolvedValue(false);
    renderDashboard(<TwoFactorRoute />);
    signOutFromMenu();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(label('admin.unexpected')));
  });

  it('leaves no alert behind when the sign-out works, and clears the style', async () => {
    session.signOutSession.mockResolvedValue(true);
    renderDashboard(<p>Page body</p>);
    signOutFromMenu();
    await waitFor(() => expect(page.loadPage).toHaveBeenCalledWith('/login'));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(storedStyle()).toBeUndefined();
  });
});
