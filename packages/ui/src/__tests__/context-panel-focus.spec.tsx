import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import { expect, it } from 'vitest';
import { ContextPanel } from '../context-panel.js';
import { DirectionProvider } from '../direction-provider.js';
import { NavRail } from '../nav-rail.js';
import { chromeLabels, contextLabels, workspaces } from './navigation-fixtures.js';

it('keeps a pending focus request until a fallback mounts in a later commit', async () => {
  function Harness() {
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    const [showOpener, setShowOpener] = useState(true);
    const [closeCommitted, setCloseCommitted] = useState(false);
    const [showFallback, setShowFallback] = useState(false);
    useEffect(() => {
      if (closeCommitted) setShowFallback(true);
    }, [closeCommitted]);
    return (
      <DirectionProvider dir="ltr">
        {showOpener ? <button type="button">Temporary opener</button> : null}
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
            setCloseCommitted(true);
          }}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  screen.getByRole('button', { name: 'Temporary opener' }).focus();
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reopen panel' })),
  );
});

it('cancels a pending focus request when the user moves focus before the fallback mounts', () => {
  function Harness() {
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    const [showOpener, setShowOpener] = useState(true);
    const [showFallback, setShowFallback] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        {showOpener ? <button type="button">Temporary opener</button> : null}
        <button type="button">User choice</button>
        <button type="button" onClick={() => setShowFallback(true)}>
          Mount fallback
        </button>
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
          }}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  screen.getByRole('button', { name: 'Temporary opener' }).focus();
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  expect(screen.queryByRole('button', { name: 'Reopen panel' })).toBeNull();
  const userChoice = screen.getByRole('button', { name: 'User choice' });
  userChoice.focus();
  fireEvent.click(screen.getByRole('button', { name: 'Mount fallback' }));
  expect(screen.getByRole('button', { name: 'Reopen panel' })).toBeTruthy();
  expect(document.activeElement).toBe(userChoice);
});

it('focuses returnFocusRef instead of document.body when opened without prior element focus', () => {
  function Harness() {
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    return (
      <DirectionProvider dir="ltr">
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
  expect(document.activeElement).toBe(document.body);
  fireEvent.click(screen.getByRole('button', { name: contextLabels.close }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stable fallback' }));
});

it('cancels a pending focus request if the panel reopens before the fallback mounts', () => {
  function Harness() {
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    const [showOpener, setShowOpener] = useState(true);
    const [showFallback, setShowFallback] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        {showOpener ? <button type="button">Temporary opener</button> : null}
        <button type="button" onClick={() => setOpen(true)}>
          Reopen externally
        </button>
        <button type="button" onClick={() => setShowFallback(true)}>
          Mount fallback
        </button>
        {showFallback ? (
          <button ref={fallbackRef} type="button">
            Late fallback
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
          }}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  screen.getByRole('button', { name: 'Temporary opener' }).focus();
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  fireEvent.click(screen.getByRole('button', { name: 'Reopen externally' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mount fallback' }));
  expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Late fallback' }));
});

it('skips an opener hidden from assistive tech and focuses the visible fallback', () => {
  function Harness() {
    const fallbackRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(true);
    const [hideOpener, setHideOpener] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        <div aria-hidden={hideOpener ? 'true' : undefined}>
          <button type="button">Temporary opener</button>
        </div>
        <button ref={fallbackRef} type="button">
          Stable fallback
        </button>
        <ContextPanel
          workspaces={workspaces}
          labels={contextLabels}
          panelOpen={open}
          currentWorkspaceId="business"
          returnFocusRef={fallbackRef}
          onClose={() => {
            setOpen(false);
            setHideOpener(true);
          }}
        />
      </DirectionProvider>
    );
  }

  render(<Harness />);
  screen.getByRole('button', { name: 'Temporary opener' }).focus();
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Stable fallback' }));
});

it('returns focus to the rail button captured from a click without focus transfer', () => {
  function Harness() {
    const openerRef = useRef<HTMLButtonElement>(null);
    const [open, setOpen] = useState(false);
    return (
      <DirectionProvider dir="ltr">
        <input aria-label="Outside field" />
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
  screen.getByRole('textbox', { name: 'Outside field' }).focus();
  const railButton = screen.getByRole('button', { name: 'Business Current Inspect' });
  fireEvent.click(railButton);
  const close = screen.getByRole('button', { name: contextLabels.close });
  close.focus();
  fireEvent.click(close);
  expect(document.activeElement).toBe(railButton);
});
