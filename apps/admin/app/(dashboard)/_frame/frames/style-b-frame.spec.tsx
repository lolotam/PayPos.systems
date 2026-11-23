import { t } from '@pospay/i18n';
import { fireEvent, screen, within } from '@testing-library/react';
import { usePathname } from 'next/navigation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveTopLevels } from '../menu/resolve-top-levels';
import {
  frameState,
  goTo,
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
const barNav = () => screen.getByRole('navigation', { name: label('shell.navigation') });
const module = (name: string) =>
  within(barNav()).getByRole('button', { name: new RegExp(`^${name}`) });

beforeEach(() => {
  resetFrameState();
  stubViewport(1280);
});
afterEach(() => vi.unstubAllGlobals());

describe.each(['ltr', 'rtl'] as const)('style B in %s', (dir) => {
  it('marks the current module in the bar and the current page in the local list', () => {
    frameState.pathname = '/staff/import';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>, dir);
    const people = module(label('adminNav.moduleBPeople'));
    expect(people.getAttribute('aria-current')).toBe('page');
    expect(people.querySelector('[data-current-marker]')).toBeTruthy();
    const list = within(localList());
    expect(list.getByRole('link', { name: /Import employees/ }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(list.getByRole('link', { name: /^Employees/ }).getAttribute('aria-current')).toBeNull();
  });

  it('marks the Business module for Staff app columns', () => {
    frameState.pathname = '/staff-app-columns';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>, dir);
    expect(module(label('adminNav.moduleBBusiness')).getAttribute('aria-current')).toBe('page');
  });
});

describe('style B layout', () => {
  it('puts the local list beside the page at 240px and keeps it out of the bar', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const list = localList();
    const main = screen.getByRole('main');
    expect(list.parentElement?.parentElement).toBe(main.parentElement);
    expect(list.parentElement?.nextElementSibling).toBe(main);
    expect(list.parentElement?.parentElement?.className).toContain('min-[1024px]:flex-row');
    expect(list.className).toContain('min-[1024px]:w-60');
    expect(
      screen.getAllByRole('navigation', { name: label('adminNav.localNavigation') }),
    ).toHaveLength(1);
    expect(barNav().contains(list)).toBe(false);
  });

  it('bounds the local list height from 1024px so it scrolls inside itself, not the page', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    expect(localList().className).toContain('min-[1024px]:max-h-[calc(100dvh-4rem-1px)]');
    expect(localList().className).toContain('min-[1024px]:sticky');
    expect(localList().className).toContain('min-[1024px]:overflow-y-auto');
  });

  it('groups the local list under the section headings of the module', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const headings = within(localList())
      .getAllByRole('heading')
      .map((heading) => heading.textContent);
    expect(headings.slice(0, 3)).toEqual([
      label('adminNav.submenuEmployees'),
      label('adminNav.submenuSchedules'),
      label('adminNav.submenuAttendance'),
    ]);
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
    expect(list.parentElement?.parentElement?.className).toContain('flex-col');
    expect(
      list.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe('style B local list', () => {
  it('draws no local list on a route outside every module', () => {
    frameState.pathname = '/nowhere';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    expect(
      screen.queryByRole('navigation', { name: label('adminNav.localNavigation') }),
    ).toBeNull();
  });

  it('keeps the module and its local list on the overview address the model generates', () => {
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    fireEvent.click(module(label('adminNav.moduleBPeople')));
    const overview = within(screen.getByRole('dialog')).getByRole('link', {
      name: label('adminNav.overview'),
    });
    const href = overview.getAttribute('href') ?? '';
    expect(href).toBe('/overview/people');
    goTo(href);
    expect(module(label('adminNav.moduleBPeople')).getAttribute('aria-current')).toBe('page');
    const list = within(localList());
    expect(list.getByRole('link', { name: /Import employees/ })).toBeTruthy();
    expect(
      list.getAllByRole('link').filter((item) => item.hasAttribute('aria-current')),
    ).toHaveLength(0);
  });
});

describe('style B visibility', () => {
  it('omits a module whose pages are all hidden', () => {
    frameState.visible = ['dashboard', 'record-visit'];
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const modules = within(barNav()).getAllByRole('button');
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

describe('style B open state across routes', () => {
  it('closes an open mega menu on navigation and does not reopen it on the way back', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    fireEvent.click(module(label('adminNav.moduleBPeople')));
    expect(screen.getByRole('dialog', { name: label('adminNav.moduleBPeople') })).toBeTruthy();
    goTo('/leave');
    expect(screen.queryByRole('dialog')).toBeNull();
    goTo('/staff');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes the phone drawer on navigation and does not reopen it on the way back', () => {
    stubViewport(390);
    frameState.pathname = '/';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    fireEvent.click(screen.getByRole('button', { name: label('shell.openNavigation') }));
    expect(screen.getByRole('dialog', { name: label('adminNav.drawerTitle') })).toBeTruthy();
    goTo('/staff');
    expect(screen.queryByRole('dialog')).toBeNull();
    goTo('/');
    expect(screen.queryByRole('dialog')).toBeNull();
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

function CurrentRoute() {
  return <p>Route: {usePathname()}</p>;
}

describe('style B bar across routes', () => {
  it('keeps the same module bar element when moving between two pages of one module', () => {
    frameState.pathname = '/staff';
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const bar = barNav();
    goTo('/staff/import');
    expect(barNav()).toBe(bar);
    expect(module(label('adminNav.moduleBPeople')).getAttribute('aria-current')).toBe('page');
  });

  it('opens a page from the mega menu through the router, the menu being frame-owned', () => {
    frameState.pathname = '/staff';
    renderFrame(
      <StyleBFrame>
        <CurrentRoute />
      </StyleBFrame>,
    );
    fireEvent.click(module(label('adminNav.moduleBPeople')));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('link', { name: /Import employees/ }),
    );
    expect(screen.getByText('Route: /staff/import')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the Soon mark in the rendered local list', () => {
  it('is on every not-built page of every module, reached through the module overview address', () => {
    renderFrame(<StyleBFrame>Page body</StyleBFrame>);
    const ctx = {
      translate: (key: Parameters<typeof t>[1]) => t('en', key),
      pathname: '/',
      visibleIds: frameState.visible,
    };
    let checked = 0;
    for (const top of resolveTopLevels('B', ctx)) {
      goTo(`/overview/${top.id}`);
      const links = within(localList()).getAllByRole('link');
      for (const page of top.lists.flatMap((list) => list.pages).filter((item) => item.status)) {
        const shown = links.find((item) => item.getAttribute('href') === page.href);
        expect(shown?.textContent).toContain(label('adminNav.soonBadge'));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });
});
