import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { TopNav, type TopNavProps } from '../top-nav.js';
import { chromeLabels, modules } from './navigation-fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function tree(props: Partial<TopNavProps> = {}) {
  return (
    <DirectionProvider dir="ltr">
      <input aria-label="Outside field" />
      <TopNav modules={modules} labels={chromeLabels} {...props} />
    </DirectionProvider>
  );
}

function stubBreakpoints(width: { value: number }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      query === '(width < 700px)'
        ? width.value < 700
        : query === '(width < 1024px)'
          ? width.value < 1024
          : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

it('releases an open menu and moves focus at the fractional 699.5px phone boundary', async () => {
  const width = { value: 700 };
  stubBreakpoints(width);
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

it('closes an open menu and restores focus to its opener at the fractional 1023.5/1024 boundary', async () => {
  const width = { value: 1024 };
  stubBreakpoints(width);
  const view = render(tree({ currentModuleId: 'sell' }));
  const opener = screen.getByRole('button', { name: /People/ });
  const currentTrigger = screen.getByRole('button', { name: /Sell/ });
  opener.focus();
  fireEvent.click(opener);
  expect(screen.getByRole('dialog', { name: 'People' }).contains(document.activeElement)).toBe(true);

  width.value = 1023.5;
  view.rerender(tree({ currentModuleId: 'sell' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(document.activeElement).not.toBe(currentTrigger);
});

it('does not reuse a pre-breakpoint opener for a new menu after returning to desktop', async () => {
  const width = { value: 1024 };
  stubBreakpoints(width);
  const view = render(tree({ currentModuleId: 'sell' }));
  const firstOpener = screen.getByRole('button', { name: /People/ });
  firstOpener.focus();
  fireEvent.click(firstOpener);

  width.value = 699;
  view.rerender(tree({ currentModuleId: 'sell' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  width.value = 1024;
  view.rerender(tree({ currentModuleId: 'sell' }));
  const nextOpener = screen.getByRole('button', { name: /Grow/ });
  nextOpener.focus();
  fireEvent.click(nextOpener);
  const dialog = screen.getByRole('dialog', { name: 'Grow' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(nextOpener));
  expect(document.activeElement).not.toBe(firstOpener);
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

it('falls back to the current trigger when a hidden opener refuses focus', async () => {
  stubBreakpoints({ value: 1200 });
  render(tree({ currentModuleId: 'sell' }));
  const opener = screen.getByRole('button', { name: /Business/ });
  opener.focus();
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'Business' });

  opener.style.display = 'none';
  // jsdom still focuses display:none elements, unlike a real browser.
  vi.spyOn(opener, 'focus').mockImplementation(() => {});

  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /Sell/ }));
});

it('keeps a short local page label at a 44px touch target', () => {
  stubBreakpoints({ value: 1200 });
  const shortLabelModules = modules.map((module) =>
    module.id === 'sell'
      ? {
          ...module,
          sections: [
            { id: 'sell-short', label: 'Orders', pages: [{ id: 'ai', label: 'AI', href: '#ai' }] },
          ],
        }
      : module,
  );
  render(tree({ modules: shortLabelModules, currentModuleId: 'sell', visiblePageIds: ['ai'] }));
  const local = screen.getByRole('navigation', { name: chromeLabels.localNavigation });
  expect(within(local).getByRole('link', { name: 'AI' }).className).toContain('min-w-11');
});

it('moves focus to the visible control when CSS hides the focused closed-menu control across 700px', async () => {
  const width = { value: 820 };
  stubBreakpoints(width);
  const view = render(tree({ currentModuleId: 'people' }));
  const moduleTrigger = screen.getByRole('button', { name: /People/ });
  moduleTrigger.focus();
  // jsdom applies no CSS: blur() stands in for the browser dropping focus from a hidden control.
  moduleTrigger.blur();
  expect(document.activeElement).toBe(document.body);

  width.value = 699;
  view.rerender(tree({ currentModuleId: 'people' }));
  const drawerTrigger = screen.getByRole('button', { name: chromeLabels.drawerOpen });
  await waitFor(() => expect(document.activeElement).toBe(drawerTrigger));

  drawerTrigger.blur();
  width.value = 700;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /People/ })),
  );
});

it('leaves focus alone across 700px after the user clicked away from the navigation', async () => {
  const width = { value: 820 };
  stubBreakpoints(width);
  const view = render(tree({ currentModuleId: 'people' }));
  const moduleTrigger = screen.getByRole('button', { name: /People/ });
  moduleTrigger.focus();
  moduleTrigger.blur();
  // Page content may stop propagation; the press must still count as leaving the navigation.
  const outside = screen.getByRole('textbox', { name: 'Outside field' });
  outside.addEventListener('pointerup', (event) => event.stopPropagation());
  fireEvent.pointerUp(outside);

  width.value = 699;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: chromeLabels.drawerOpen })).toBeTruthy(),
  );
  expect(document.activeElement).toBe(document.body);
});

it('leaves focus alone across 700px when a touch tap moved focus after pointerup', async () => {
  const width = { value: 820 };
  stubBreakpoints(width);
  const view = render(tree({ currentModuleId: 'people' }));
  const moduleTrigger = screen.getByRole('button', { name: /People/ });
  moduleTrigger.focus();
  // Touch browsers apply the tap's focus change after pointerup, so the trigger is still focused here.
  fireEvent.pointerUp(document.body);
  expect(document.activeElement).toBe(moduleTrigger);
  moduleTrigger.blur();
  fireEvent.click(document.body);

  width.value = 699;
  view.rerender(tree({ currentModuleId: 'people' }));
  await waitFor(() =>
    expect(screen.getByRole('button', { name: chromeLabels.drawerOpen })).toBeTruthy(),
  );
  expect(document.activeElement).toBe(document.body);
});

it('marks the layout it has settled on after each breakpoint focus decision', async () => {
  const width = { value: 820 };
  stubBreakpoints(width);
  const view = render(tree({ currentModuleId: 'people' }));
  expect(view.container.querySelector('[data-settled-layout="tablet"]')).not.toBeNull();
  screen.getByRole('button', { name: /People/ }).focus();

  const drawerOpener = screen.getByRole('button', { name: chromeLabels.drawerOpen });
  let markerDuringFocus: string | null | undefined;
  drawerOpener.addEventListener(
    'focus',
    () => {
      markerDuringFocus = view.container
        .querySelector('[data-settled-layout]')
        ?.getAttribute('data-settled-layout');
    },
    { once: true },
  );

  width.value = 699;
  view.rerender(tree({ currentModuleId: 'people' }));

  await waitFor(() =>
    expect(view.container.querySelector('[data-settled-layout="phone"]')).not.toBeNull(),
  );
  // The marker is written after the focus transfer, so focus has already reached the drawer opener.
  expect(document.activeElement).toBe(drawerOpener);
  // During the transfer the marker still holds the layout the nav had settled on before the change.
  expect(markerDuringFocus).toBe('tablet');
});

it('writes the settled layout marker when visible modules mount later without a viewport change (#1207)', () => {
  const width = { value: 820 };
  stubBreakpoints(width);
  const view = render(tree({ visiblePageIds: [] }));
  // TopNav renders nothing while no module has a visible page, so there is no root to mark yet.
  expect(view.container.querySelector('[data-settled-layout]')).toBeNull();

  view.rerender(tree({ currentModuleId: 'people' }));

  expect(view.container.querySelector('[data-settled-layout="tablet"]')).not.toBeNull();
});
