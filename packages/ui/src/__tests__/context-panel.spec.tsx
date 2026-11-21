import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ContextPanel, type ContextPanelProps } from '../context-panel.js';
import { DirectionProvider } from '../direction-provider.js';
import { contextLabels, workspaces } from './navigation-fixtures.js';

function tree(dir: 'rtl' | 'ltr', props: Partial<ContextPanelProps> = {}) {
  return (
    <DirectionProvider dir={dir}>
      <ContextPanel workspaces={workspaces} labels={contextLabels} panelOpen onClose={vi.fn()} {...props} />
    </DirectionProvider>
  );
}

it('stays closed when the panel is hidden', () => {
  render(tree('ltr', { panelOpen: false }));
  expect(screen.queryByRole('complementary', { name: contextLabels.navigation })).toBeNull();
});

it.each(['rtl', 'ltr'] as const)(
  'shows the inspected workspace, active page and 272px panel in %s',
  (dir) => {
    const onClose = vi.fn();
    render(
      tree(dir, {
        currentWorkspaceId: 'front-desk',
        inspectedWorkspaceId: 'business',
        activePageId: 'columns',
        onClose,
      }),
    );
    const panel = screen.getByRole('complementary', { name: contextLabels.navigation });
    expect(panel.getAttribute('dir')).toBe(dir);
    expect(panel.className).toContain('min-[600px]:start-21');
    expect(panel.className).toContain('min-[600px]:w-68');
    expect(screen.getByRole('heading', { name: 'Business' })).toBeTruthy();
    const active = screen.getByRole('link', { name: 'الأعمدة' });
    expect(active.getAttribute('aria-current')).toBe('page');
    expect(active.className).toContain('bg-sidebar-primary');
    expect(screen.getByRole('link', { name: /العروض/ }).textContent).toContain('Soon');
    fireEvent.click(screen.getByRole('button', { name: contextLabels.close }));
    expect(onClose).toHaveBeenCalledTimes(1);
  },
);

it('falls back to the current workspace and filters hidden pages', () => {
  render(tree('ltr', { currentWorkspaceId: 'business', visiblePageIds: ['offers'] }));
  expect(screen.getByRole('heading', { name: 'Business' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'الأعمدة' })).toBeNull();
  expect(screen.getByRole('link', { name: /العروض/ })).toBeTruthy();
});

it('shows the empty state when inspection data is absent or fully filtered', () => {
  const view = render(tree('ltr'));
  expect(screen.getByRole('heading', { name: contextLabels.empty })).toBeTruthy();
  expect(screen.getAllByText(contextLabels.empty)).toHaveLength(2);
  view.unmount();

  render(tree('ltr', { currentWorkspaceId: 'front-desk', visiblePageIds: ['missing'] }));
  expect(screen.getByRole('heading', { name: 'Front desk' })).toBeTruthy();
  expect(screen.getAllByText(contextLabels.empty)).toHaveLength(1);
});
