import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextPanel } from '../context-panel.js';
import { DirectionProvider } from '../direction-provider.js';
import { NavRail } from '../nav-rail.js';
import { chromeLabels, contextLabels, workspaces } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

function stubViewportWidth(width: number) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 600px) and (width < 1024px)' && width >= 600 && width < 1024,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

it('traps Tab and Shift+Tab, closes on Escape from filter input, and restores opener focus at 820px', () => {
  stubViewportWidth(820);
  function Harness() {
    const openerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        <button type="button">Outside action</button>
        <NavRail
          workspaces={workspaces}
          labels={chromeLabels}
          currentWorkspaceId="business"
          panelOpen={open}
          onInspect={(_workspaceId, opener) => {
            openerRef.current = opener;
            setOpen(true);
          }}
        />
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          currentWorkspaceId="business"
          panelOpen={open}
          openerRef={openerRef}
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const railButton = screen.getByRole('button', { name: 'Business Current Inspect' });
  fireEvent.click(railButton);
  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  expect(dialog.getAttribute('aria-modal')).toBe('true');

  const closeButton = screen.getByRole('button', { name: contextLabels.close });
  const links = screen.getAllByRole('link');
  const lastLink = links[links.length - 1];
  expect(lastLink).toBeTruthy();
  if (!lastLink) return;
  expect(document.activeElement).toBe(closeButton);

  fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
  expect(document.activeElement).toBe(lastLink);

  fireEvent.keyDown(lastLink, { key: 'Tab' });
  expect(document.activeElement).toBe(closeButton);

  const filter = screen.getByRole('searchbox', { name: contextLabels.filterPages });
  filter.focus();
  fireEvent.keyDown(filter, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(railButton);
});

it('blocks background button activation while the tablet modal is open and closes on backdrop click', () => {
  stubViewportWidth(820);
  const outsideAction = vi.fn();
  function Harness() {
    const openerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        <button type="button" onClick={outsideAction}>
          Outside destructive action
        </button>
        <NavRail
          workspaces={workspaces}
          labels={chromeLabels}
          currentWorkspaceId="business"
          panelOpen={open}
          onInspect={(_workspaceId, opener) => {
            openerRef.current = opener;
            setOpen(true);
          }}
        />
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          currentWorkspaceId="business"
          panelOpen={open}
          openerRef={openerRef}
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const railButton = screen.getByRole('button', { name: 'Business Current Inspect' });
  fireEvent.click(railButton);

  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  const closeButton = screen.getByRole('button', { name: contextLabels.close });
  const outsideButton = screen.getByRole('button', { name: 'Outside destructive action' });
  outsideButton.focus();
  fireEvent.click(outsideButton);
  expect(outsideAction).not.toHaveBeenCalled();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(closeButton);

  const backdrop = document.querySelector('[data-context-panel-backdrop]');
  expect(backdrop).toBeTruthy();
  if (backdrop) fireEvent.click(backdrop);
  expect(screen.queryByRole('dialog', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(railButton);

  fireEvent.click(outsideButton);
  expect(outsideAction).toHaveBeenCalledTimes(1);
});

it('keeps focus inside the tablet dialog when visiblePageIds removes the focused link', () => {
  stubViewportWidth(820);
  const { rerender } = render(
    <DirectionProvider dir="ltr">
      <ContextPanel
        workspaces={workspaces}
        labels={contextLabels}
        currentWorkspaceId="business"
        visiblePageIds={['columns', 'offers']}
        panelOpen
        onClose={() => undefined}
      />
    </DirectionProvider>,
  );
  const columnsLink = screen.getByRole('link', { name: 'الأعمدة' });
  columnsLink.focus();
  expect(document.activeElement).toBe(columnsLink);

  rerender(
    <DirectionProvider dir="ltr">
      <ContextPanel
        workspaces={workspaces}
        labels={contextLabels}
        currentWorkspaceId="business"
        visiblePageIds={['offers']}
        panelOpen
        onClose={() => undefined}
      />
    </DirectionProvider>,
  );

  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  expect(screen.queryByRole('link', { name: 'الأعمدة' })).toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: contextLabels.close }));
});

it('preserves the original observed opener across outside clicks while the tablet modal is open', () => {
  stubViewportWidth(820);
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        <button type="button" onClick={() => setOpen(true)}>
          Actual opener
        </button>
        <button type="button" onClick={() => setOpen(true)}>
          Outside no-op
        </button>
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          currentWorkspaceId="business"
          panelOpen={open}
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const actualOpener = screen.getByRole('button', { name: 'Actual opener' });
  actualOpener.focus();
  fireEvent.click(actualOpener);

  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  const outsideNoOp = screen.getByRole('button', { name: 'Outside no-op' });
  outsideNoOp.focus();
  fireEvent.click(outsideNoOp);
  expect(dialog.contains(document.activeElement)).toBe(true);

  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(actualOpener);
});

it('allows switching workspaces by keyboard inside the open tablet modal', () => {
  stubViewportWidth(820);
  function Harness() {
    const openerRef = useRef<HTMLButtonElement>(null);
    const [inspectedWorkspaceId, setInspectedWorkspaceId] = useState<string>('business');
    const [open, setOpen] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        <NavRail
          workspaces={workspaces}
          labels={chromeLabels}
          currentWorkspaceId="business"
          inspectedWorkspaceId={inspectedWorkspaceId}
          panelOpen={open}
          onInspect={(workspaceId, opener) => {
            openerRef.current = opener;
            setInspectedWorkspaceId(workspaceId);
            setOpen(true);
          }}
        />
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          currentWorkspaceId="business"
          inspectedWorkspaceId={inspectedWorkspaceId}
          panelOpen={open}
          openerRef={openerRef}
          onInspect={(workspaceId) => setInspectedWorkspaceId(workspaceId)}
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const businessRail = screen.getByRole('button', { name: 'Business Current Inspect' });
  businessRail.focus();
  fireEvent.click(businessRail);

  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  const businessSwitcher = screen.getByRole('button', { name: 'Business' });
  const teamSwitcher = screen.getByRole('button', { name: 'Team' });
  expect(dialog.contains(teamSwitcher)).toBe(true);
  expect(businessSwitcher.className).toContain('min-h-11');
  expect(businessSwitcher.className).toContain('min-w-11');
  expect(businessSwitcher.className).toContain('max-w-full');
  expect(businessSwitcher.getAttribute('aria-current')).toBe('page');
  expect(businessSwitcher.querySelector('[data-current-marker]')).toBeTruthy();

  teamSwitcher.focus();
  expect(document.activeElement).toBe(teamSwitcher);
  fireEvent.click(teamSwitcher);

  expect(screen.getByRole('heading', { name: 'Team' })).toBeTruthy();
  expect(teamSwitcher.getAttribute('aria-pressed')).toBe('true');
  expect(teamSwitcher.getAttribute('aria-current')).toBeNull();
  expect(businessSwitcher.getAttribute('aria-pressed')).toBe('false');
  expect(businessSwitcher.getAttribute('aria-current')).toBe('page');
  expect(businessSwitcher.querySelector('[data-current-marker]')).toBeTruthy();
  expect(dialog.contains(document.activeElement)).toBe(true);

  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(businessRail);
});

it('keeps the single remaining workspace switchable when the inspected workspace becomes empty', () => {
  stubViewportWidth(820);
  function Harness() {
    const [inspectedWorkspaceId, setInspectedWorkspaceId] = useState<string>('business');
    return (
      <DirectionProvider dir="ltr">
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          currentWorkspaceId="business"
          inspectedWorkspaceId={inspectedWorkspaceId}
          visiblePageIds={['employees']}
          panelOpen
          onInspect={(workspaceId) => setInspectedWorkspaceId(workspaceId)}
          onClose={() => undefined}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  const teamSwitcher = screen.getByRole('button', { name: 'Team' });
  expect(dialog.contains(teamSwitcher)).toBe(true);
  fireEvent.click(teamSwitcher);
  expect(screen.getByRole('heading', { name: 'Team' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'الموظفون' })).toBeTruthy();
});

it.each(['dialog', 'alertdialog'] as const)(
  'leaves a separate %s usable while the tablet modal is open',
  (role) => {
    stubViewportWidth(820);
    const confirm = vi.fn();
    const onClose = vi.fn();
    render(
      <DirectionProvider dir="ltr">
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          currentWorkspaceId="business"
          panelOpen
          onClose={onClose}
        />
        <div role={role} aria-label="Confirm">
          <button type="button" onClick={confirm}>
            Confirm action
          </button>
        </div>
      </DirectionProvider>,
    );
    const confirmButton = screen.getByRole('button', { name: 'Confirm action' });
    confirmButton.focus();
    expect(document.activeElement).toBe(confirmButton);

    fireEvent.keyDown(confirmButton, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(confirmButton);
    expect(confirm).toHaveBeenCalledTimes(1);
  },
);
