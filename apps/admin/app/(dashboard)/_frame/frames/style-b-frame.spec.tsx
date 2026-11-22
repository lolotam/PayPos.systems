import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  frameState,
  renderFrame,
  resetFrameState,
  selectBusiness,
  stubViewport,
} from './frame-test-support';
import { StyleBFrame } from './style-b-frame';

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
const localList = () => screen.getByRole('navigation', { name: label('adminNav.localNavigation') });

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['ltr', 'rtl'] as const)('style B in %s', (dir) => {
  it('marks the current module in the bar and the current page in the local list', () => {
    frameState.pathname = '/staff/import';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>, dir);
    const bar = screen.getByRole('navigation', { name: label('shell.navigation') });
    const people = within(bar).getByRole('button', {
      name: new RegExp(label('adminNav.moduleBPeople')),
    });
    expect(people.getAttribute('aria-current')).toBe('page');
    expect(people.querySelector('[data-current-marker]')).toBeTruthy();
    expect(
      within(localList())
        .getByRole('link', { name: /Import employees/ })
        .getAttribute('aria-current'),
    ).toBe('page');
    expect(
      within(localList())
        .getByRole('link', { name: /^Employees/ })
        .getAttribute('aria-current'),
    ).toBeNull();
  });

  it('marks the Business module for Staff app columns', () => {
    frameState.pathname = '/staff-app-columns';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>, dir);
    const bar = screen.getByRole('navigation', { name: label('shell.navigation') });
    expect(
      within(bar)
        .getByRole('button', { name: new RegExp(label('adminNav.moduleBBusiness')) })
        .getAttribute('aria-current'),
    ).toBe('page');
  });
});

describe('style B layout', () => {
  it('puts the local list beside the page at 240px and keeps it out of the bar', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const list = localList();
    const main = screen.getByRole('main');
    expect(list.parentElement).toBe(main.parentElement);
    expect(list.nextElementSibling).toBe(main);
    expect(list.parentElement?.className).toContain('min-[1024px]:flex-row');
    expect(list.className).toContain('min-[1024px]:w-60');
    expect(
      screen.getAllByRole('navigation', { name: label('adminNav.localNavigation') }),
    ).toHaveLength(1);
    expect(screen.getByRole('navigation', { name: label('shell.navigation') }).contains(list)).toBe(
      false,
    );
  });

  it('keeps the workspace switcher and the account controls in the bar', () => {
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    expect(screen.getByRole('button', { name: /Synthetic business/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: label('adminNav.accountMenuLabel') })).toBeTruthy();
  });

  it('stacks the list above the page below 1024px', () => {
    stubViewport(820);
    frameState.pathname = '/staff';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const list = localList();
    expect(list.parentElement?.className).toContain('flex-col');
    expect(
      list.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('draws no local list on a route outside every module', () => {
    frameState.pathname = '/nowhere';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    expect(
      screen.queryByRole('navigation', { name: label('adminNav.localNavigation') }),
    ).toBeNull();
  });
});

describe('style B visibility', () => {
  it('omits a module whose pages are all hidden', () => {
    frameState.visible = ['dashboard', 'record-visit'];
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const bar = screen.getByRole('navigation', { name: label('shell.navigation') });
    const modules = within(bar).getAllByRole('button');
    expect(modules).toHaveLength(2);
    expect(modules[0]?.textContent).toContain(label('adminNav.moduleBToday'));
    expect(modules[1]?.textContent).toContain(label('adminNav.moduleBSell'));
  });

  it('loses a restaurant-only page after the business changes to a salon', () => {
    frameState.pathname = '/orders/service-sessions/new';
    const { rerenderFrame } = renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const kitchen = within(localList()).getByRole('link', { name: /Kitchen screens/ });
    expect(kitchen.textContent).toContain(label('adminNav.soonBadge'));
    selectBusiness('salon');
    rerenderFrame(<StyleBFrame>Page body</StyleBFrame>);
    expect(within(localList()).queryByRole('link', { name: /Kitchen screens/ })).toBeNull();
    expect(within(localList()).getByRole('link', { name: /Record a visit/ })).toBeTruthy();
  });
});

describe('style B on a phone', () => {
  it('reaches a page of another module through the drawer in three taps', () => {
    stubViewport(390);
    frameState.pathname = '/';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    fireEvent.click(screen.getByRole('button', { name: label('shell.openNavigation') }));
    const drawer = screen.getByRole('dialog', { name: label('adminNav.drawerTitle') });
    fireEvent.click(
      within(drawer).getByRole('button', { name: new RegExp(label('adminNav.moduleBPeople')) }),
    );
    expect(
      within(drawer)
        .getByRole('link', { name: /Import employees/ })
        .getAttribute('href'),
    ).toBe('/staff/import');
  });
});
