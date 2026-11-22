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

it('returns focus inside the tablet dialog immediately when switching workspaces from NavRail', () => {
  stubViewportWidth(820);
  function Harness() {
    const openerRef = useRef<HTMLButtonElement>(null);
    const [inspectedWorkspaceId, setInspectedWorkspaceId] = useState<string>('business');
    const [open, setOpen] = useState(true);
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
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const teamRailButton = screen.getByRole('button', { name: 'Team Inspect' });
  teamRailButton.focus();
  fireEvent.click(teamRailButton);

  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  const closeButton = screen.getByRole('button', { name: contextLabels.close });
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(closeButton);
});

it('keeps focus inside the tablet dialog when visiblePageIds removes the focused link', () => {
  stubViewportWidth(820);
  function Harness() {
    const [visiblePageIds, setVisiblePageIds] = useState<string[] | undefined>(['columns', 'offers']);
    return (
      <DirectionProvider dir="ltr">
        <button type="button" onClick={() => setVisiblePageIds(['offers'])}>
          Hide columns
        </button>
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          currentWorkspaceId="business"
          visiblePageIds={visiblePageIds}
          panelOpen
          onClose={() => undefined}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const columnsLink = screen.getByRole('link', { name: 'الأعمدة' });
  columnsLink.focus();
  expect(document.activeElement).toBe(columnsLink);

  fireEvent.click(screen.getByRole('button', { name: 'Hide columns' }));

  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  expect(screen.queryByRole('link', { name: 'الأعمدة' })).toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: contextLabels.close }));
});

it('contains focus on an outside no-op click while preserving NavRail workspace switching at 820px', () => {
  stubViewportWidth(820);
  function Harness() {
    const openerRef = useRef<HTMLButtonElement>(null);
    const [inspectedWorkspaceId, setInspectedWorkspaceId] = useState<string>('business');
    const [open, setOpen] = useState(true);
    return (
      <DirectionProvider dir="ltr">
        <button type="button" onClick={() => setOpen(true)}>
          Reopen panel
        </button>
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
          onClose={() => setOpen(false)}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  const closeButton = screen.getByRole('button', { name: contextLabels.close });

  const reopenButton = screen.getByRole('button', { name: 'Reopen panel' });
  reopenButton.focus();
  fireEvent.click(reopenButton);
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(closeButton);

  const teamRailButton = screen.getByRole('button', { name: 'Team Inspect' });
  teamRailButton.focus();
  fireEvent.click(teamRailButton);
  expect(screen.getByRole('heading', { name: 'Team' })).toBeTruthy();
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).toBe(closeButton);
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
  const teamSwitcher = screen.getByRole('button', { name: 'Team' });
  expect(dialog.contains(teamSwitcher)).toBe(true);
  teamSwitcher.focus();
  expect(document.activeElement).toBe(teamSwitcher);
  fireEvent.click(teamSwitcher);

  expect(screen.getByRole('heading', { name: 'Team' })).toBeTruthy();
  expect(teamSwitcher.getAttribute('aria-pressed')).toBe('true');
  expect(dialog.contains(document.activeElement)).toBe(true);

  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(businessRail);
});
