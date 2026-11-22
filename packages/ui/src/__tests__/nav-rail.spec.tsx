import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { NavRail, type NavRailProps } from '../nav-rail.js';
import { chromeLabels, workspaces } from './navigation-fixtures.js';

function tree(dir: 'rtl' | 'ltr', props: Partial<NavRailProps> = {}) {
  return (
    <DirectionProvider dir={dir}>
      <NavRail
        workspaces={workspaces}
        labels={chromeLabels}
        panelOpen={false}
        onInspect={vi.fn()}
        {...props}
      />
    </DirectionProvider>
  );
}

it('keeps the 84px rail, current marker and panel toggle state', () => {
  const onInspect = vi.fn();
  const view = render(
    tree('ltr', {
      currentWorkspaceId: 'stock',
      inspectedWorkspaceId: 'stock',
      panelOpen: true,
      onInspect,
    }),
  );
  const rail = screen.getByRole('navigation', { name: chromeLabels.navigation });
  expect(rail.className).toContain('w-21');
  expect(rail.getAttribute('dir')).toBe('ltr');
  const inspected = screen.getByRole('button', { name: 'Stock Current Hide panel' });
  expect(inspected.getAttribute('aria-pressed')).toBe('true');
  expect(inspected.getAttribute('data-current')).toBe('');
  expect(inspected.className).toContain('bg-sidebar-primary');
  fireEvent.click(inspected);
  expect(onInspect).toHaveBeenCalledTimes(1);
  expect(onInspect.mock.calls[0]?.[0]).toBe('stock');
  expect(onInspect.mock.calls[0]?.[1]).toBe(inspected);
  expect(view.container.querySelectorAll('button')).toHaveLength(workspaces.length);
});

it('defaults the inspected workspace to the current one when the panel is open', () => {
  render(tree('ltr', { currentWorkspaceId: 'stock', panelOpen: true }));
  const current = screen.getByRole('button', { name: 'Stock Current Hide panel' });
  expect(current.getAttribute('aria-pressed')).toBe('true');
  expect(current.getAttribute('data-current')).toBe('');
  expect(current.querySelector('[data-current-marker]')).toBeTruthy();
});

it('distinguishes an explicitly previewed workspace from the current one', () => {
  render(
    tree('ltr', { currentWorkspaceId: 'stock', inspectedWorkspaceId: 'business', panelOpen: true }),
  );
  expect(screen.getByRole('button', { name: 'Business Hide panel' }).getAttribute('aria-pressed')).toBe('true');
  const current = screen.getByRole('button', { name: 'Stock Current Inspect' });
  expect(current.getAttribute('data-current')).toBe('');
  expect(current.getAttribute('aria-pressed')).toBe('false');
  expect(current.querySelector('[data-current-marker]')).toBeTruthy();
});

it('does not mark a hidden panel as pressed', () => {
  render(tree('ltr', { currentWorkspaceId: 'stock', inspectedWorkspaceId: 'customers' }));
  const button = screen.getByRole('button', { name: 'Customers Inspect' });
  expect(button.getAttribute('aria-pressed')).toBe('false');
  expect(button.className).not.toContain('bg-sidebar-primary');
  expect(screen.getByRole('button', { name: 'Stock Current Inspect' })).toBeTruthy();
});

it.each(['rtl', 'ltr'] as const)('keeps rail direction and logical icon anchoring in %s', (dir) => {
  render(tree(dir));
  const rail = screen.getByRole('navigation', { name: chromeLabels.navigation });
  expect(rail.getAttribute('dir')).toBe(dir);
  for (const button of rail.querySelectorAll('button')) {
    const icon = button.querySelector('span[aria-hidden="true"]');
    expect(icon).toBeTruthy();
  }
});

it('shows a visible translated label when the workspace has no icon', () => {
  const sections = [{ id: 's', label: 'S', pages: [{ id: 'p', label: 'P', href: '#p' }] }];
  render(tree('ltr', { workspaces: [{ id: 'plain', label: 'Plain workspace', sections }] }));
  const button = screen.getByRole('button', { name: 'Plain workspace Inspect' });
  expect(
    screen.getAllByText('Plain workspace').some((node) => !node.className.includes('sr-only')),
  ).toBe(true);
  expect(button.textContent).toContain('Plain workspace');
});

it('shows no rail button for a workspace whose pages are all hidden', () => {
  render(tree('ltr', { visiblePageIds: ['employees'] }));
  expect(screen.getByRole('button', { name: /^Team/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Business/ })).toBeNull();
});

it('keeps focus in the rail when a visibility update removes the focused workspace', () => {
  const view = render(tree('ltr', { currentWorkspaceId: 'business' }));
  const team = screen.getByRole('button', { name: /^Team/ });
  team.focus();

  view.rerender(tree('ltr', { currentWorkspaceId: 'business', visiblePageIds: ['columns'] }));

  expect(screen.queryByRole('button', { name: /^Team/ })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Business/ }));
});
