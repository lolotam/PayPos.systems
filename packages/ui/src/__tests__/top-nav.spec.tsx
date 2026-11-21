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
      <TopNav modules={modules} labels={chromeLabels} {...props} />
    </DirectionProvider>
  );
}

it('keeps the requested menu open without marking it current', () => {
  stubMedia(() => false);
  render(tree({ currentModuleId: 'sell' }));
  fireEvent.click(screen.getByRole('button', { name: /Sell/ }));
  expect(screen.getByRole('dialog', { name: 'Sell' })).toBeTruthy();
  expect(screen.queryByRole('dialog', { name: 'Grow' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /Grow/, hidden: true }));
  expect(screen.queryByRole('dialog', { name: 'Sell' })).toBeNull();
  expect(screen.getByRole('dialog', { name: 'Grow' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Grow/, hidden: true }).getAttribute('aria-current')).toBeNull();
  expect(screen.getByRole('button', { name: /Sell/, hidden: true }).getAttribute('aria-current')).toBe('page');
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

it('releases the drawer focus trap when the breakpoint changes', async () => {
  let phone = true;
  stubMedia(() => phone);
  const view = render(tree({ currentModuleId: 'people' }));
  fireEvent.click(screen.getByRole('button', { name: chromeLabels.drawerOpen }));
  expect(screen.getByRole('dialog', { name: chromeLabels.drawerTitle })).toBeTruthy();
  phone = false;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
