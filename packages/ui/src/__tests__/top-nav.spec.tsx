import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { TopNav, type TopNavProps } from '../top-nav.js';
import { chromeLabels, modules } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

function stubMedia(isPhone: () => boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches: isPhone(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

async function waitForOnlyDialog(name: string) {
  await waitFor(() => {
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name })).toBeTruthy();
  });
}

function tree(props: Partial<TopNavProps> = {}, dir: 'rtl' | 'ltr' = 'ltr') {
  return (
    <DirectionProvider dir={dir}>
      <input aria-label="Outside field" />
      <TopNav modules={modules} labels={chromeLabels} {...props} />
    </DirectionProvider>
  );
}

it('switches modules from visible controls inside the open menu by pointer and keyboard', async () => {
  stubMedia(() => false);
  render(tree({ currentModuleId: 'sell' }));
  const opener = screen.getByRole('button', { name: /Sell/ });
  expect(opener.querySelector('[data-current-marker]')).toBeTruthy();
  expect(opener.className).toContain('underline');
  opener.focus();
  fireEvent.click(opener);
  const sellDialog = screen.getByRole('dialog', { name: 'Sell' });
  expect(document.activeElement && sellDialog.contains(document.activeElement)).toBe(true);
  const switcherCurrent = within(sellDialog).getByRole('button', { name: /Sell.*Current/ });
  expect(switcherCurrent.querySelector('[data-current-marker]')).toBeTruthy();
  expect(switcherCurrent.className).toContain('bg-sidebar-primary');

  const growSwitch = within(sellDialog).getByRole('button', { name: /Grow/ });
  expect(growSwitch.hasAttribute('hidden')).toBe(false);
  expect(growSwitch.closest('[aria-hidden="true"]')).toBeNull();
  fireEvent.click(growSwitch);
  const growDialog = screen.getByRole('dialog', { name: 'Grow' });
  expect(screen.queryByRole('dialog', { name: 'Sell' })).toBeNull();

  const peopleSwitch = within(growDialog).getByRole('button', { name: /People/ });
  peopleSwitch.focus();
  fireEvent.keyDown(peopleSwitch, { key: 'Enter' });
  expect(screen.getByRole('dialog', { name: 'People' })).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: 'Grow' })).toBeNull();
  const currentSwitcher = screen.getByRole('button', { name: /Sell.*Current/ });
  expect(currentSwitcher.getAttribute('aria-current')).toBe('page');
  expect(currentSwitcher.querySelector('[data-current-marker]')).toBeTruthy();
  expect(currentSwitcher.className).toContain('bg-sidebar-primary');
});

it('returns focus to the original opener after switching modules in an open menu', async () => {
  stubMedia(() => false);
  render(tree({ currentModuleId: 'sell' }));
  const opener = screen.getByRole('button', { name: /Sell/ });
  opener.focus();
  fireEvent.click(opener);

  const sellDialog = screen.getByRole('dialog', { name: 'Sell' });
  fireEvent.click(within(sellDialog).getByRole('button', { name: /Grow/ }));
  const growDialog = screen.getByRole('dialog', { name: 'Grow' });
  fireEvent.keyDown(document.activeElement ?? growDialog, { key: 'Escape' });

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
});

it('keeps the original opener after an intermediate module close finishes', async () => {
  stubMedia(() => false);
  render(tree({ currentModuleId: 'business' }));
  const opener = screen.getByRole('button', { name: /Business/ });
  opener.focus();
  fireEvent.click(opener);

  const businessDialog = screen.getByRole('dialog', { name: 'Business' });
  fireEvent.click(within(businessDialog).getByRole('button', { name: /People/ }));
  await waitForOnlyDialog('People');
  const peopleDialog = screen.getByRole('dialog', { name: 'People' });
  fireEvent.keyDown(document.activeElement ?? peopleDialog, { key: 'Escape' });

  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
});

it('focuses a visible trigger when the opener disappears while a menu is open', async () => {
  stubMedia(() => false);
  const view = render(tree({ currentModuleId: 'business', visiblePageIds: ['columns'] }));
  const opener = screen.getByRole('button', { name: /Business/ });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'Business' })).toBeTruthy();

  view.rerender(tree({ currentModuleId: 'business', visiblePageIds: ['employees'] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /People/ })),
  );
});

it('focuses a visible trigger when the switched-to module disappears', async () => {
  stubMedia(() => false);
  const view = render(tree({ currentModuleId: 'business' }));
  const opener = screen.getByRole('button', { name: /Business/ });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Business' })).getByRole('button', { name: /People/ }),
  );
  await waitForOnlyDialog('People');

  view.rerender(tree({ currentModuleId: 'business', visiblePageIds: ['columns'] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Business/ })),
  );
});

it('restores a connected opener when visibility filtering closes the open module', async () => {
  stubMedia(() => false);
  const view = render(tree({ currentModuleId: 'sell' }));
  const opener = screen.getByRole('button', { name: /Business/ });
  opener.focus();
  fireEvent.click(opener);
  fireEvent.click(
    within(screen.getByRole('dialog', { name: 'Business' })).getByRole('button', { name: /People/ }),
  );
  await waitForOnlyDialog('People');

  view.rerender(tree({ currentModuleId: 'sell', visiblePageIds: ['orders', 'columns'] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it('renders overview, supplied destinations and a scrollable short-window menu', async () => {
  stubMedia(() => false);
  const onNavigate = vi.fn();
  render(tree({ currentModuleId: 'business', onNavigate }));
  fireEvent.click(screen.getByRole('button', { name: /Business/ }));
  const dialog = screen.getByRole('dialog', { name: 'Business' });
  expect(dialog.className).toContain('overflow-y-auto');
  expect(within(dialog).getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('#business');
  const column = within(dialog).getByRole('link', { name: /Columns/ });
  expect(column.getAttribute('href')).toBe('/staff-app-columns');
  fireEvent.click(column);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it('omits a mega-menu section whose last page is hidden', () => {
  stubMedia(() => false);
  const modulesWithHiddenSection = modules.map((module) =>
    module.id === 'business'
      ? {
          ...module,
          sections: [
            ...module.sections,
            {
              id: 'business-hidden',
              label: 'Hidden section',
              pages: [{ id: 'hidden', label: 'Hidden page', href: '#hidden' }],
            },
          ],
        }
      : module,
  );
  render(
    tree({
      modules: modulesWithHiddenSection,
      currentModuleId: 'business',
      visiblePageIds: ['columns'],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: /Business/ }));
  const dialog = screen.getByRole('dialog', { name: 'Business' });
  expect(within(dialog).getByRole('link', { name: 'Columns' })).toBeTruthy();
  expect(within(dialog).queryByRole('heading', { name: 'Hidden section' })).toBeNull();
});

it('marks the supplied active page in the local list and uses wide geometry', () => {
  stubMedia(() => false);
  const view = render(tree({ currentModuleId: 'business', activePageId: 'columns' }));
  const local = screen.getByRole('navigation', { name: chromeLabels.localNavigation });
  expect(within(local).getByRole('link', { name: /Columns/ }).getAttribute('aria-current')).toBe('page');
  expect(local.className).toContain('min-[1024px]:w-60');
  expect(view.container.querySelector('header')?.className).toContain('min-[1024px]:h-16');
});

it.each(['rtl', 'ltr'] as const)('navigates from the phone drawer in %s', async (dir) => {
  stubMedia(() => true);
  const onNavigate = vi.fn();
  render(tree({ currentModuleId: 'people', activePageId: 'employees', onNavigate }, dir));
  fireEvent.click(screen.getByRole('button', { name: chromeLabels.drawerOpen }));
  const dialog = screen.getByRole('dialog', { name: chromeLabels.drawerTitle });
  expect(dialog.getAttribute('dir')).toBe(dir);
  expect(dialog.className).toContain('w-76');
  expect(dialog.className).toContain('overflow-y-auto');
  expect(within(dialog).getByRole('button', { name: /People/ }).getAttribute('aria-expanded')).toBe('true');

  fireEvent.click(within(dialog).getByRole('button', { name: /Sell/ }));
  const destination = within(dialog).getByRole('link', { name: 'Sales orders' });
  expect(destination.getAttribute('href')).toBe('#orders');
  fireEvent.click(destination);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(onNavigate).toHaveBeenCalledTimes(1);
});

it('expands the first visible module when the supplied current module has no visible pages', () => {
  stubMedia(() => true);
  render(tree({ currentModuleId: 'people', visiblePageIds: ['approvals'] }));
  fireEvent.click(screen.getByRole('button', { name: chromeLabels.drawerOpen }));
  const dialog = screen.getByRole('dialog', { name: chromeLabels.drawerTitle });
  expect(within(dialog).getByRole('button', { name: /Today/ }).getAttribute('aria-expanded')).toBe('true');
  expect(within(dialog).queryByRole('button', { name: /People/ })).toBeNull();
});

it('closes on Escape without navigating and returns focus to the opener', async () => {
  stubMedia(() => true);
  const onNavigate = vi.fn();
  render(tree({ currentModuleId: 'people', onNavigate }));
  const opener = screen.getByRole('button', { name: chromeLabels.drawerOpen });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: chromeLabels.drawerTitle });
  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
  expect(onNavigate).not.toHaveBeenCalled();
});

it('releases the drawer focus trap and transfers focus across 699 and 700', async () => {
  let phone = true;
  stubMedia(() => phone);
  const view = render(tree({ currentModuleId: 'people' }));
  fireEvent.click(screen.getByRole('button', { name: chromeLabels.drawerOpen }));
  expect(screen.getByRole('dialog', { name: chromeLabels.drawerTitle })).toBeTruthy();

  phone = false;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /People/ })),
  );

  phone = true;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: chromeLabels.drawerOpen }),
    ),
  );
});

it('transfers focus from an open menu to the visible phone trigger at 700 to 699', async () => {
  let phone = false;
  stubMedia(() => phone);
  const view = render(tree({ currentModuleId: 'people' }));
  fireEvent.click(screen.getByRole('button', { name: /People/ }));
  expect(screen.getByRole('dialog', { name: 'People' })).toBeTruthy();

  phone = true;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: chromeLabels.drawerOpen }),
    ),
  );
});

it('contains the open menu focus and returns it to the visible opener on Escape', async () => {
  stubMedia(() => false);
  render(tree({ currentModuleId: 'sell' }));
  const opener = screen.getByRole('button', { name: /Sell/ });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Sell' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Tab' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
});

it('renders no navigation chrome when every module has zero visible pages', () => {
  stubMedia(() => false);
  render(tree({ currentModuleId: 'business', visiblePageIds: [] }));
  expect(screen.queryByRole('button', { name: /Business/ })).toBeNull();
  expect(screen.queryByRole('button', { name: chromeLabels.drawerOpen })).toBeNull();
  expect(screen.queryByRole('navigation', { name: chromeLabels.localNavigation })).toBeNull();
});

it('revokes open chrome when visibility changes to zero', async () => {
  stubMedia(() => false);
  const view = render(tree({ currentModuleId: 'business', visiblePageIds: ['columns'] }));
  fireEvent.click(screen.getByRole('button', { name: /Business/ }));
  expect(screen.getByRole('dialog', { name: 'Business' })).toBeTruthy();
  view.rerender(tree({ currentModuleId: 'business', visiblePageIds: [] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.queryByRole('button', { name: /Business/ })).toBeNull();
  expect(screen.queryByRole('navigation', { name: chromeLabels.localNavigation })).toBeNull();
});

it('does not reopen a hidden menu when its module becomes visible again', async () => {
  stubMedia(() => false);
  const view = render(tree({ currentModuleId: 'business', visiblePageIds: ['columns'] }));
  fireEvent.click(screen.getByRole('button', { name: /Business/ }));
  expect(screen.getByRole('dialog', { name: 'Business' })).toBeTruthy();
  view.rerender(tree({ currentModuleId: 'business', visiblePageIds: [] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  view.rerender(tree({ currentModuleId: 'business', visiblePageIds: ['columns'] }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Business/ })).toBeTruthy());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not reopen a menu when its module returns after a partial visibility change', async () => {
  stubMedia(() => false);
  const view = render(tree({ currentModuleId: 'business', visiblePageIds: ['columns', 'employees'] }));
  fireEvent.click(screen.getByRole('button', { name: /Business/ }));
  expect(screen.getByRole('dialog', { name: 'Business' })).toBeTruthy();

  view.rerender(tree({ currentModuleId: 'business', visiblePageIds: ['employees'] }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  view.rerender(tree({ currentModuleId: 'business', visiblePageIds: ['columns', 'employees'] }));
  await waitFor(() => expect(screen.getByRole('button', { name: /Business/ })).toBeTruthy());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('does not reopen a menu when prefiltered modules change without visiblePageIds', async () => {
  stubMedia(() => false);
  const withoutPeoplePages = modules.map((module) =>
    module.id === 'people'
      ? {
          ...module,
          sections: module.sections.map((section) => ({ ...section, pages: [] })),
        }
      : module,
  );
  const view = render(tree({ currentModuleId: 'business' }));
  fireEvent.click(screen.getByRole('button', { name: /Business/ }));
  expect(screen.getByRole('dialog', { name: 'Business' })).toBeTruthy();

  view.rerender(tree({ currentModuleId: 'business', modules: withoutPeoplePages }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  view.rerender(tree({ currentModuleId: 'business' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('keeps focus on a visible module trigger when another module loses its only page', async () => {
  stubMedia(() => false);
  const view = render(
    tree({ currentModuleId: 'business', visiblePageIds: ['columns', 'employees'] }),
  );
  screen.getByRole('button', { name: /Business/ }).focus();

  view.rerender(tree({ currentModuleId: 'business', visiblePageIds: ['columns'] }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Business/ })),
  );
});

it('returns focus to the reopened menu trigger after a breakpoint round trip', async () => {
  let phone = false;
  stubMedia(() => phone);
  const view = render(tree({ currentModuleId: 'business' }));
  screen.getByRole('button', { name: /Business/ }).focus();

  phone = true;
  view.rerender(tree({ currentModuleId: 'business' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: chromeLabels.drawerOpen })),
  );

  phone = false;
  view.rerender(tree({ currentModuleId: 'business' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Business/ })),
  );

  const people = screen.getByRole('button', { name: /People/ });
  people.focus();
  fireEvent.click(people);
  const dialog = screen.getByRole('dialog', { name: 'People' });
  expect(dialog.contains(document.activeElement)).toBe(true);

  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(people);
});

it('keeps focus outside the navigation when the phone breakpoint changes', async () => {
  let phone = true;
  stubMedia(() => phone);
  const view = render(tree({ currentModuleId: 'people' }));
  const outside = screen.getByRole('textbox', { name: 'Outside field' });
  outside.focus();
  expect(document.activeElement).toBe(outside);

  phone = false;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() => expect(document.activeElement).toBe(outside));

  phone = true;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() => expect(document.activeElement).toBe(outside));
});
