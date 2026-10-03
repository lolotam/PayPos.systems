import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AppSidebar } from '../app-sidebar.js';
import { AppSidebarItem } from '../app-sidebar-item.js';
import { DirectionProvider } from '../direction-provider.js';

afterEach(() => vi.unstubAllGlobals());

function media(matches: boolean) {
  vi.stubGlobal('matchMedia', () => ({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

function sidebar(dir: 'rtl' | 'ltr') {
  return (
    <DirectionProvider dir={dir}>
      <AppSidebar
        title="fixture.navigation"
        openLabel="fixture.open"
        closeLabel="fixture.close"
        header={<input aria-label="fixture.workspace" />}
        navigation={<AppSidebarItem icon={<svg />} label="fixture.home" href="#home" active />}
        footer={<button>fixture.signOut</button>}
      />
    </DirectionProvider>
  );
}

it.each(['rtl', 'ltr'] as const)(
  'opens a modal drawer in %s and returns focus on Escape',
  async (dir) => {
    media(false);
    render(sidebar(dir));
    const trigger = screen.getByRole('button', { name: 'fixture.open' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'fixture.navigation' });
    expect(dialog.getAttribute('dir')).toBe(dir);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const link = screen.getByRole('link', { name: 'fixture.home' });
    expect(link.getAttribute('dir')).toBe(dir);
    const dot = link.querySelector('.bg-sidebar-active');
    expect(dot?.classList.contains('start-3')).toBe(true);
    expect(link.classList.contains('relative')).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  },
);

it('closes after navigation, with the active destination and footer still actionable', async () => {
  media(false);
  render(sidebar('rtl'));
  fireEvent.click(screen.getByRole('button', { name: 'fixture.open' }));
  const link = screen.getByRole('link', { name: 'fixture.home' });
  expect(link.getAttribute('aria-current')).toBe('page');
  expect(
    screen.getByRole('button', { name: 'fixture.signOut' }).getAttribute('disabled'),
  ).toBeNull();
  fireEvent.click(link);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('renders one desktop workspace selector without a modal or menu trigger', () => {
  media(true);
  render(sidebar('ltr'));
  expect(screen.getAllByRole('textbox', { name: 'fixture.workspace' })).toHaveLength(1);
  expect(screen.getByRole('navigation', { name: 'fixture.navigation' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'fixture.open' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['rtl', 'ltr'] as const)('anchors the active dot to logical inline-start in %s', (dir) => {
  render(
    <DirectionProvider dir={dir}>
      <AppSidebarItem href="#home" icon={<svg />} label="fixture.home" active />
    </DirectionProvider>,
  );
  const link = screen.getByRole('link', { name: 'fixture.home' });
  expect(link.getAttribute('dir')).toBe(dir);
  expect(link.querySelector('.bg-sidebar-active')?.classList.contains('start-3')).toBe(true);
  expect(link.classList.contains('relative')).toBe(true);
});
