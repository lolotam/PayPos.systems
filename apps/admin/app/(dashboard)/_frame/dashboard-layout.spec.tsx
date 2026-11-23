import { screen, within } from '@testing-library/react';
import { renderFrame, resetFrameState, stubViewport } from './frames/frame-test-support';
import { visibleStyles } from './dashboard-test-support';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardLayout from '../layout';

const stored = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'pospay_nav_style' && stored.value !== undefined
        ? { name, value: stored.value }
        : undefined,
  }),
}));
vi.mock('@/session/pages/session-gate', () => ({
  SessionGate: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock(
  'next/navigation',
  async () => (await import('./frames/frame-test-support')).navigationMock,
);
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

async function renderLayout() {
  const tree = await DashboardLayout({ children: <p>Page body</p> });
  return renderFrame(tree);
}

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
  stored.value = undefined;
});

describe('the style the dashboard layout draws first', () => {
  it.each(['A', 'B', 'C'])('draws the stored style %s', async (value) => {
    stored.value = value;
    await renderLayout();
    expect(visibleStyles()).toEqual([value]);
    expect(within(screen.getByRole('main')).getByText('Page body')).toBeTruthy();
  });

  it.each([undefined, '', 'D', 'a', 'AB'])('draws style C for the stored value %j', async (value) => {
    stored.value = value;
    await renderLayout();
    expect(visibleStyles()).toEqual(['C']);
  });
});
