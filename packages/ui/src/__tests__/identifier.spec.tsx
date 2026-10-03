import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Identifier } from '../identifier.js';

afterEach(() => vi.unstubAllGlobals());
const value = '01920000-0000-7000-8000-000000000010';
const copy = { label: 'fixture.copy', success: 'fixture.copied', error: 'fixture.failed' };

it('shortens the display while preserving and copying the complete identifier', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<Identifier value={value} copy={copy} />);
  expect(screen.getByText('01920000…').title).toBe(value);
  fireEvent.click(screen.getByRole('button', { name: copy.label }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.success));
  expect(writeText).toHaveBeenCalledExactlyOnceWith(value);
});

it('announces a failed copy without claiming success', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error('Synthetic clipboard denial'));
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  render(<Identifier value={value} copy={copy} />);
  fireEvent.click(screen.getByRole('button', { name: copy.label }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(copy.error));
});
