import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { expect, it } from 'vitest';
import { BottomSheet } from '../bottom-sheet.js';
import { DirectionProvider } from '../direction-provider.js';

function Host({ dir = 'ltr' }: { dir?: 'ltr' | 'rtl' }) {
  const [open, setOpen] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);
  return (
    <DirectionProvider dir={dir}>
      <input aria-label="Outside field" />
      <button ref={openerRef} type="button" onClick={() => setOpen(true)}>
        More
      </button>
      <BottomSheet
        openerRef={openerRef}
        open={open}
        onOpenChange={setOpen}
        title="More sections"
        closeLabel="Close sheet"
      >
        <a href="#reports">Reports</a>
      </BottomSheet>
    </DirectionProvider>
  );
}

it('opens as a named modal dialog and moves focus inside it', () => {
  render(<Host />);
  expect(screen.queryByRole('dialog')).toBeNull();
  const opener = screen.getByRole('button', { name: 'More' });
  fireEvent.click(opener);
  const dialog = screen.getByRole('dialog', { name: 'More sections' });
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(screen.getByRole('link', { name: 'Reports' })).toBeTruthy();
});

it('hides the page behind it from assistive technology while open', () => {
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.queryByRole('textbox', { name: 'Outside field' })).toBeNull();
});

it('closes on Escape and returns focus to the button that opened it', async () => {
  render(<Host />);
  const opener = screen.getByRole('button', { name: 'More' });
  fireEvent.click(opener);
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it('closes from its close button and returns focus the same way', async () => {
  render(<Host />);
  const opener = screen.getByRole('button', { name: 'More' });
  fireEvent.click(opener);
  fireEvent.click(screen.getByRole('button', { name: 'Close sheet' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(document.activeElement).toBe(opener));
});

it('follows the reading direction', () => {
  render(<Host dir="rtl" />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('dialog').getAttribute('dir')).toBe('rtl');
});

it('keeps Tab inside the sheet by wrapping from the last control to the first', () => {
  render(<Host />);
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  const last = screen.getByRole('link', { name: 'Reports' });
  last.focus();
  fireEvent.keyDown(last, { key: 'Tab' });
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close sheet' }));
});

it('returns focus to the button that opened it even when the click did not move focus there', async () => {
  render(<Host />);
  const field = screen.getByRole('textbox', { name: 'Outside field' });
  field.focus();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'More' })),
  );
  expect(document.activeElement).not.toBe(field);
});
