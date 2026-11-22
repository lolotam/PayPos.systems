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
