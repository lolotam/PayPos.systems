import { render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { DirectionProvider } from '../direction-provider.js';
import { ModuleDrawer } from '../module-drawer.js';
import { chromeLabels, modules } from './navigation-fixtures.js';

afterEach(() => vi.unstubAllGlobals());

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
