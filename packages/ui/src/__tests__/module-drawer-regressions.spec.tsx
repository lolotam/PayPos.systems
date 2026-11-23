import { render, screen, waitFor } from '@testing-library/react';
import { act, useState } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { ModuleDrawer } from '../module-drawer.js';
import { chromeLabels, modules } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

function HydrationHarness() {
  const [open, setOpen] = useState(true);
  return (
    <DirectionProvider dir="ltr">
      <ModuleDrawer
        modules={modules}
        labels={chromeLabels}
        open={open}
        currentModuleId="business"
        onOpenChange={setOpen}
      />
      <span data-testid="drawer-open-state">{open ? 'open' : 'closed'}</span>
    </DirectionProvider>
  );
}

async function hydrateAt(width: number) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(width < 700px)' ? width < 700 : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const container = document.createElement('div');
  container.innerHTML = renderToString(<HydrationHarness />);
  document.body.append(container);
  let root: ReturnType<typeof hydrateRoot> | undefined;
  await act(async () => {
    root = hydrateRoot(container, <HydrationHarness />);
  });
  if (!root) throw new Error('hydration root was not created');
  return { container, root };
}

it('closes a standalone drawer and releases focus when the trigger disappears at 700px', async () => {
  const width = { value: 699 };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(width < 700px)' ? width.value < 700 : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <DirectionProvider dir="ltr">
        <ModuleDrawer
          modules={modules}
          labels={chromeLabels}
          open={open}
          currentModuleId="business"
          onOpenChange={setOpen}
        />
      </DirectionProvider>
    );
  }

  const view = render(<Harness />);
  const dialog = screen.getByRole('dialog', { name: chromeLabels.drawerTitle });
  expect(dialog.contains(document.activeElement)).toBe(true);

  width.value = 700;
  view.rerender(<Harness />);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

it('does not trap focus in a standalone drawer mounted open at 700px', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));

  function Harness() {
    const [open, setOpen] = useState(true);
    return (
      <DirectionProvider dir="ltr">
        <ModuleDrawer
          modules={modules}
          labels={chromeLabels}
          open={open}
          currentModuleId="business"
          onOpenChange={setOpen}
        />
        <button type="button">Outside drawer</button>
      </DirectionProvider>
    );
  }

  render(<Harness />);
  const outside = screen.getByRole('button', { name: 'Outside drawer' });
  outside.focus();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(outside);
});

it('keeps a drawer open through hydration at 699px', async () => {
  const { container, root } = await hydrateAt(699);
  try {
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: chromeLabels.drawerTitle })).toBeTruthy(),
    );
    expect(screen.getByTestId('drawer-open-state').textContent).toBe('open');
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('keeps a drawer closed through hydration at 700px', async () => {
  const { container, root } = await hydrateAt(700);
  try {
    await waitFor(() => expect(screen.getByTestId('drawer-open-state').textContent).toBe('closed'));
    expect(screen.queryByRole('dialog')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

it('never lets a crowded top bar shrink the phone button below its 44px target', () => {
  render(
    <DirectionProvider dir="ltr">
      <ModuleDrawer
        modules={modules}
        labels={chromeLabels}
        open={false}
        currentModuleId="business"
        onOpenChange={() => undefined}
      />
    </DirectionProvider>,
  );
  const trigger = screen.getByRole('button', { name: chromeLabels.drawerOpen });
  // Structure only: jsdom has no layout. The 44px width under a long business name is a browser check.
  expect(trigger.className).toContain('size-11');
  expect(trigger.className).toContain('shrink-0');
});
