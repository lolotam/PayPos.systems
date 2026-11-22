import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { TopNav, type TopNavProps } from '../top-nav.js';
import { chromeLabels, modules } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

function tree(props: Partial<TopNavProps> = {}) {
  return (
    <DirectionProvider dir="ltr">
      <input aria-label="Outside field" />
      <TopNav modules={modules} labels={chromeLabels} {...props} />
    </DirectionProvider>
  );
}

function stubPhoneBoundary(width: { value: number }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(width < 700px)' ? width.value < 700 : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

it('releases an open menu and moves focus at the fractional 699.5px phone boundary', async () => {
  const width = { value: 700 };
  stubPhoneBoundary(width);
  const view = render(tree({ currentModuleId: 'business' }));
  const opener = screen.getByRole('button', { name: /Business/ });
  opener.focus();
  fireEvent.click(opener);
  const desktopDialog = screen.getByRole('dialog', { name: 'Business' });
  expect(desktopDialog.contains(document.activeElement)).toBe(true);

  width.value = 699.5;
  view.rerender(tree({ currentModuleId: 'business' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const drawerTrigger = screen.getByRole('button', { name: chromeLabels.drawerOpen });
  await waitFor(() => expect(document.activeElement).toBe(drawerTrigger));
});

it('keeps a visible current marker in the drawer after expanding another module', () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  render(tree({ currentModuleId: 'business' }));
  fireEvent.click(screen.getByRole('button', { name: chromeLabels.drawerOpen }));
  const dialog = screen.getByRole('dialog', { name: chromeLabels.drawerTitle });
  const current = within(dialog).getByRole('button', { name: /Business/ });
  expect(current.getAttribute('aria-current')).toBe('page');
  const marker = current.querySelector('[data-current-marker]');
  expect(marker?.className).toContain('bg-current');
  expect(marker?.className).not.toContain('sr-only');

  fireEvent.click(within(dialog).getByRole('button', { name: /People/ }));
  expect(current.getAttribute('aria-expanded')).toBe('false');
  expect(current.querySelector('[data-current-marker]')).toBeTruthy();
});
