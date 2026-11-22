import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContextPanel } from '../context-panel.js';
import { DirectionProvider } from '../direction-provider.js';
import { NavRail } from '../nav-rail.js';
import { PageFinder } from '../page-finder.js';
import { chromeLabels, contextLabels, finderLabels, workspaces } from './navigation-fixtures.js';

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

it('hides and blocks the background while the tablet modal is open and closes on a backdrop press', async () => {
  stubViewportWidth(820);
  const outsideAction = vi.fn();
  function Harness() {
    const openerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        <main>
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
        </main>
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
  const outsideButton = screen.getByRole('button', { name: 'Outside destructive action' });
  fireEvent.click(railButton);

  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  expect(screen.queryByRole('button', { name: 'Outside destructive action' })).toBeNull();
  expect(outsideButton.closest('[aria-hidden="true"]')).toBeTruthy();
  expect(document.body.style.pointerEvents).toBe('none');
  outsideButton.focus();
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

  const backdrop = document.querySelector('[data-context-panel-backdrop]');
  expect(backdrop).toBeTruthy();
  await waitFor(() => {
    if (backdrop?.isConnected) {
      fireEvent.pointerDown(backdrop);
      fireEvent.pointerUp(backdrop);
      fireEvent.click(backdrop);
    }
    expect(screen.queryByRole('dialog', { name: contextLabels.navigation })).toBeNull();
  });
  expect(document.activeElement).toBe(railButton);
  expect(outsideAction).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Outside destructive action' }));
  expect(outsideAction).toHaveBeenCalledTimes(1);
});

it('keeps focus inside the tablet dialog when visiblePageIds removes the focused link', async () => {
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
  await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
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
  const outsideNoOp = screen.getByRole('button', { name: 'Outside no-op' });
  actualOpener.focus();
  fireEvent.click(actualOpener);

  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  outsideNoOp.focus();
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

it('lets the page finder open over the tablet modal and closes only the finder on Escape', async () => {
  stubViewportWidth(820);
  const onClose = vi.fn();
  render(
    <DirectionProvider dir="ltr">
      <PageFinder workspaces={workspaces} labels={finderLabels} />
      <ContextPanel
        workspaces={workspaces}
        labels={contextLabels}
        currentWorkspaceId="business"
        panelOpen
        onClose={onClose}
      />
    </DirectionProvider>,
  );
  expect(screen.getByRole('dialog', { name: contextLabels.navigation })).toBeTruthy();

  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const finder = await screen.findByRole('dialog', { name: finderLabels.title });
  const search = screen.getByRole('searchbox', { name: finderLabels.search });
  await waitFor(() => expect(document.activeElement).toBe(search));

  fireEvent.keyDown(search, { key: 'Escape' });
  await waitFor(() => expect(finder.isConnected).toBe(false));
  expect(onClose).not.toHaveBeenCalled();
  const panel = screen.getByRole('dialog', { name: contextLabels.navigation });
  await waitFor(() => expect(panel.contains(document.activeElement)).toBe(true));
});

it('keeps the focus a destination page took in the same commit that closes the tablet modal', () => {
  stubViewportWidth(820);
  function Destination({ arrived }: { arrived: boolean }) {
    const headingRef = useRef<HTMLHeadingElement>(null);
    useEffect(() => {
      if (arrived) headingRef.current?.focus();
    }, [arrived]);
    return (
      <h1 ref={headingRef} tabIndex={-1}>
        Destination page
      </h1>
    );
  }
  function Harness() {
    const openerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    const [arrived, setArrived] = useState(false);
    return (
      <DirectionProvider dir="ltr">
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
        <Destination arrived={arrived} />
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          currentWorkspaceId="business"
          panelOpen={open}
          openerRef={openerRef}
          onClose={() => {
            setArrived(true);
            setOpen(false);
          }}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  fireEvent.click(screen.getByRole('button', { name: 'Business Current Inspect' }));
  const dialog = screen.getByRole('dialog', { name: contextLabels.navigation });
  expect(dialog.contains(document.activeElement)).toBe(true);

  fireEvent.keyDown(document.activeElement ?? dialog, { key: 'Escape' });

  expect(screen.queryByRole('dialog', { name: contextLabels.navigation })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Destination page' }));
});
