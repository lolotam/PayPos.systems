import { t } from '@pospay/i18n';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderDashboard } from '../dashboard-test-support';
import { frameState, resetFrameState, stubViewport } from '../frames/frame-test-support';

vi.mock('next/navigation', async () => (await import('../frames/frame-test-support')).navigationMock);
vi.mock(
  '@/shared/locale/locale-context',
  async () => (await import('../frames/frame-test-support')).localeMock,
);
vi.mock(
  './use-visible-page-ids',
  async () => (await import('../frames/frame-test-support')).visibleMock,
);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('../dashboard-mocks')).dashboardWorkspaceMock,
);
vi.mock(
  '@/session/api/use-session',
  async () => (await import('../dashboard-mocks')).dashboardSessionMock,
);
vi.mock(
  '@/session/api/use-sign-out',
  async () => (await import('../frames/frame-test-support')).signOutMock,
);
vi.mock(
  '@/notifications/ui/notification-bell',
  async () => (await import('../frames/frame-test-support')).bellMock,
);
vi.mock(
  '@/shared/locale/locale-switch',
  async () => (await import('../frames/frame-test-support')).localeSwitchMock,
);

const label = (key: Parameters<typeof t>[1]) => t('en', key);
const weeklyName = label('shell.schedule_title');

function currentLinks(scope: HTMLElement) {
  return within(scope)
    .getAllByRole('link')
    .filter((link) => link.getAttribute('aria-current') === 'page');
}

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
  frameState.pathname = '/schedules/settings';
});

describe('the schedule settings entry as the current one', () => {
  it('marks the settings pill and not Weekly schedules in style A', () => {
    renderDashboard(<p>Page body</p>, 'A');
    const pills = screen.getByRole('navigation', { name: label('adminNav.pillsLabel') });
    const current = currentLinks(pills);
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe('/schedules/settings');
    expect(
      within(pills).getByRole('link', { name: weeklyName }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('marks the settings page and not Weekly schedules in the local list of style B', () => {
    renderDashboard(<p>Page body</p>, 'B');
    const list = screen.getByRole('navigation', { name: label('adminNav.localNavigation') });
    const current = currentLinks(list);
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe('/schedules/settings');
    expect(within(list).getByRole('link', { name: weeklyName }).getAttribute('aria-current')).toBeNull();
  });

  it('marks the settings page and not Weekly schedules in the panel of style C', () => {
    renderDashboard(<p>Page body</p>, 'C');
    const panel = screen.getByRole('complementary', { name: label('adminNav.localNavigation') });
    const current = currentLinks(panel);
    expect(current).toHaveLength(1);
    expect(current[0]?.getAttribute('href')).toBe('/schedules/settings');
    expect(
      within(panel).getByRole('link', { name: weeklyName }).getAttribute('aria-current'),
    ).toBeNull();
  });
});
