import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
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

it('returns focus to the inspected workspace control after the panel closes', () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    const [inspected, setInspected] = useState('business');
    return (
      <DirectionProvider dir="ltr">
        <button type="button" onClick={() => setInspected('team')}>Inspect team</button>
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          panelOpen={open}
          currentWorkspaceId="business"
          inspectedWorkspaceId={inspected}
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const inspect = screen.getByRole('button', { name: 'Inspect team' });
  inspect.focus();
  fireEvent.click(inspect);
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole('complementary', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(inspect);
});

it('restores focus after closing without an intervening re-render', () => {
  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <DirectionProvider dir="ltr">
        <button type="button">Inspect business</button>
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          panelOpen={open}
          currentWorkspaceId="business"
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Inspect business' });
  opener.focus();
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole('complementary', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(opener);
});

it('falls back to a caller-supplied visible button when the original opener is removed', () => {
  function Harness() {
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    const [showOpener, setShowOpener] = useState(true);
    return (
      <DirectionProvider dir="ltr">
        {showOpener ? (
          <button type="button" onClick={() => setShowOpener(false)}>
            Temporary opener
          </button>
        ) : null}
        <button ref={fallbackRef} type="button">
          Stable fallback
        </button>
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          panelOpen={open}
          currentWorkspaceId="business"
          returnFocusRef={fallbackRef}
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Temporary opener' });
  opener.focus();
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole('complementary', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stable fallback' }));
});

it('restores focus to a fallback that appears only after the panel closes', async () => {
  function Harness() {
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    const [showOpener, setShowOpener] = useState(true);
    const [showFallback, setShowFallback] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        {showOpener ? (
          <button type="button" onClick={() => setShowOpener(false)}>
            Temporary opener
          </button>
        ) : null}
        {showFallback ? (
          <button ref={fallbackRef} type="button">
            Reopen panel
          </button>
        ) : null}
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          panelOpen={open}
          currentWorkspaceId="business"
          returnFocusRef={fallbackRef}
          onClose={() => {
            setOpen(false);
            setShowOpener(false);
            setShowFallback(true);
          }}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'Temporary opener' });
  opener.focus();
  fireEvent.click(opener);
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reopen panel' })),
  );
});

it('falls back to the current workspace and filters hidden pages', () => {
  render(tree('ltr', { currentWorkspaceId: 'business', visiblePageIds: ['offers'] }));
  expect(screen.getByRole('heading', { name: 'Business' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'الأعمدة' })).toBeNull();
  expect(screen.getByRole('link', { name: /العروض/ })).toBeTruthy();
});

it('filters visible pages in the inspected workspace by the filter field', () => {
  render(tree('ltr', { currentWorkspaceId: 'business' }));
  const filter = screen.getByRole('searchbox', { name: 'Filter this list' });

  fireEvent.change(filter, { target: { value: 'الأعمدة' } });
  expect(screen.getByRole('link', { name: 'الأعمدة' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: /العروض/ })).toBeNull();

  fireEvent.change(filter, { target: { value: 'عروض' } });
  expect(screen.getByRole('link', { name: /العروض/ })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'الأعمدة' })).toBeNull();
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
