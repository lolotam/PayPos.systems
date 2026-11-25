import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enterWorkspace, enterWorkspaceAt, renderDashboard, resetDashboardState } from './dashboard-test-support';
import { frameState, resetFrameState, stubViewport } from './frames/frame-test-support';
import { NotFoundProbe } from './frames/not-found-probe';
import { SoonRoute } from './soon-route';

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
const route = (page: string) => {
  frameState.pathname = `/soon/${page}`;
  frameState.params = { page };
  return (
    <NotFoundProbe>
      <SoonRoute />
    </NotFoundProbe>
  );
};
const kitchenLink = () => screen.queryAllByRole('link', { name: /Kitchen screens/ });

beforeEach(() => {
  resetFrameState();
  resetDashboardState();
  stubViewport(1280);
});

describe('/soon/<page>', () => {
  it('opens the Under development page with the name of a not-built entry', () => {
    renderDashboard(route('kitchen-screens'));
    const main = within(screen.getByRole('main'));
    expect(main.getByRole('heading', { name: label('adminNavPages.kitchenScreens') })).toBeTruthy();
    expect(main.getByText(label('adminNav.underDevHeading'))).toBeTruthy();
    expect(main.getByRole('link', { name: label('adminNav.underDevBackHome') }).getAttribute('href')).toBe(
      '/',
    );
  });

  it('shows not found for an id nobody published', () => {
    renderDashboard(route('no-such-page'));
    expect(screen.getByText('Not found')).toBeTruthy();
  });

  it('shows not found for an entry the user\'s role was not planned for', () => {
    enterWorkspace('salon', 'cashier');
    renderDashboard(route('subscription-and-billing'));
    expect(screen.getByText('Not found')).toBeTruthy();
  });

  it.each([
    ['appearance', '/appearance'],
    ['approvals-inbox', '/approvals'],
  ])('forwards the old address of the built entry %s to %s', (id, address) => {
    renderDashboard(route(id));
    expect(frameState.replace).toHaveBeenCalledWith(address);
    expect(frameState.pathname).toBe(address);
    expect(screen.queryByText('Not found')).toBeNull();
  });

  it('treats the removed unpublished customer-packages Soon alias as not found (#1167)', () => {
    renderDashboard(route('customer-packages'));
    expect(frameState.replace).not.toHaveBeenCalled();
    expect(screen.getByText('Not found')).toBeTruthy();
  });
});

describe('a restaurant-only entry after the workspace changes to a salon', () => {
  it('is in the menu, the page finder and the direct link for a restaurant', () => {
    renderDashboard(route('kitchen-screens'));
    expect(kitchenLink().length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.pageFinderLabel') }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'kitchen' } });
    expect(
      within(screen.getByRole('dialog')).getByRole('link', { name: /Kitchen screens/ }),
    ).toBeTruthy();
  });

  it('leaves the menu, the page finder and the direct link once it is a salon', () => {
    const { rerenderDashboard } = renderDashboard(route('kitchen-screens'));
    enterWorkspace('salon');
    rerenderDashboard(route('kitchen-screens'));
    expect(screen.getByText('Not found')).toBeTruthy();
    expect(kitchenLink()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: label('adminNav.pageFinderLabel') }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'kitchen' } });
    expect(within(screen.getByRole('dialog')).queryByRole('link', { name: /Kitchen/ })).toBeNull();
  });

  it('shows the Under development page again after a salon without the entry and back at the same address', () => {
    enterWorkspaceAt('restaurant', 'owner', 'company-a', 'business-a');
    const { rerenderDashboard } = renderDashboard(route('kitchen-screens'));
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        name: label('adminNavPages.kitchenScreens'),
      }),
    ).toBeTruthy();
    enterWorkspaceAt('salon', 'owner', 'company-b', 'business-b');
    rerenderDashboard(route('kitchen-screens'));
    expect(screen.getByText('Not found')).toBeTruthy();
    enterWorkspaceAt('restaurant', 'owner', 'company-a', 'business-a');
    rerenderDashboard(route('kitchen-screens'));
    expect(
      within(screen.getByRole('main')).getByRole('heading', {
        name: label('adminNavPages.kitchenScreens'),
      }),
    ).toBeTruthy();
  });
});
