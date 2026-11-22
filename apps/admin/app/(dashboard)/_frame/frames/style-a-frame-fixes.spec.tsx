import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTopLevels } from '../menu/resolve-top-levels';
import {
  frameState,
  renderFrame,
  resetFrameState,
  selectBusiness,
  stubViewport,
} from './frame-test-support';
import { StyleAFrame } from './style-a-frame';

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
vi.mock(
  '@/session/api/use-session',
  async () => (await import('./frame-test-support')).sessionMock,
);
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
const moreButton = () => screen.getByRole('button', { name: label('adminNav.more') });

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
});

describe('style A when the tab row would hold one tab', () => {
  it('keeps the lone tab of a not-built page, so the Soon mark stays visible (accountant)', () => {
    selectBusiness('restaurant', 'accountant');
    frameState.pathname = '/soon/customer-wallet';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const tabs = screen.getByRole('navigation', { name: label('adminNav.tabsLabel') });
    const lone = within(tabs).getByRole('link');
    expect(lone.getAttribute('href')).toBe('/soon/customer-wallet');
    expect(lone.getAttribute('aria-current')).toBe('page');
    expect(lone.textContent).toContain(label('adminNav.soonBadge'));
  });

  it('still hides a lone tab of a built page', () => {
    frameState.visible = ['dashboard', 'employees', 'employee-numbers'];
    frameState.pathname = '/staff';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    expect(screen.queryByRole('navigation', { name: label('adminNav.tabsLabel') })).toBeNull();
  });
});

describe('style A More sheet on a phone', () => {
  beforeEach(() => stubViewport(390));
  const openSheet = () => {
    fireEvent.click(moreButton());
    return screen.getByRole('dialog', { name: label('adminNav.more') });
  };
  const openSheetOnce = () => screen.queryByRole('dialog') ?? openSheet();

  it('marks a sub-menu link with Soon when the page it opens is not built', () => {
    const ctx = {
      translate: (key: Parameters<typeof t>[1]) => t('en', key),
      pathname: '/',
      visibleIds: frameState.visible,
    };
    const lists = resolveTopLevels('A', ctx)
      .filter((group) => !group.bottomBar)
      .flatMap((group) => group.lists);
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const sheet = openSheet();
    const soonLists = lists.filter((list) => list.pages[0]?.status !== undefined);
    expect(soonLists.length).toBeGreaterThan(3);
    for (const list of lists) {
      const shown = within(sheet)
        .getAllByRole('link')
        .find((item) => item.getAttribute('href') === list.href);
      const marked = shown?.textContent?.includes(label('adminNav.soonBadge'));
      expect(marked).toBe(list.pages[0]?.status !== undefined);
    }
  });

  it('marks More and its current section while the current page is behind it', () => {
    frameState.pathname = '/staff/attendance-report';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    expect(moreButton().getAttribute('aria-current')).toBe('true');
    const sheet = openSheet();
    const section = (name: string) =>
      within(sheet).getByRole('heading', { name: new RegExp(`^${name}`) }).parentElement;
    expect(section(label('adminNav.groupAReports'))?.textContent).toContain(
      label('adminNav.currentStyleBadge'),
    );
    expect(section(label('adminNav.groupASetup'))?.textContent).not.toContain(
      label('adminNav.currentStyleBadge'),
    );
  });

  it('closes the sheet on a plain click on the current page link, and not on a modified click', () => {
    frameState.pathname = '/staff/attendance-report';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    const own = () =>
      within(openSheetOnce()).getByRole('link', { name: label('adminNav.submenuStaffReports') });
    fireEvent.click(own(), { ctrlKey: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(own());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('does not mark More while the current page is on the bottom bar', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleAFrame>Page body</StyleAFrame>);
    expect(moreButton().getAttribute('aria-current')).toBeNull();
  });
});
