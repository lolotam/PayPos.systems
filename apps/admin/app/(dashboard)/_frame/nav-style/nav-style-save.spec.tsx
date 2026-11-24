import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';
import { announceIdentityChange } from '@/shared/browser/load-page';

import { NavStyleProvider } from './nav-style-context';
import { NavStyleSaveProbe } from './nav-style-save-probe.fixture';

const api = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PUT: api.put }) }));
const success = { response: { ok: true } };
const cookieStyle = () => document.cookie.split('; ').find((v) => v.startsWith('pospay_nav_style='))?.split('=')[1];
const renderProbe = () => render(<LocaleProvider locale="en" setLocale={() => undefined}>
  <NavStyleProvider initialStyle="C"><NavStyleSaveProbe /></NavStyleProvider>
</LocaleProvider>);
beforeEach(() => { vi.resetAllMocks(); api.put.mockResolvedValue(success); });

it('changes the visible frame and cookie immediately, sending one PUT without permissions or workspace', async () => {
  renderProbe();
  fireEvent.click(screen.getByText('Choose A'));
  expect(screen.getByText('Frame A')).toBeTruthy();
  expect(cookieStyle()).toBe('A');
  await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
  expect(api.put.mock.calls[0]?.slice(0, 2)).toEqual(['/v1/me/preferences', { body: { navStyle: 'A' }, signal: expect.any(AbortSignal) }]);
});
it('coalesces three choices, never overlaps requests, and sends C only after A finishes', async () => {
  let complete: ((value: unknown) => void) | undefined;
  api.put.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  renderProbe();
  for (const next of ['A', 'B', 'C']) fireEvent.click(screen.getByText(`Choose ${next}`));
  expect(screen.getByText('Frame C')).toBeTruthy();
  expect(cookieStyle()).toBe('C');
  expect(api.put).toHaveBeenCalledTimes(1);
  await act(async () => { complete?.(success); });
  expect(api.put.mock.calls.map((call) => call[1].body.navStyle)).toEqual(['A', 'C']);
});
it.each(['refusal', 'network'])('keeps frame and cookie on %s, with one persistent alert cleared by the next success', async (failure) => {
  if (failure === 'network') api.put.mockRejectedValueOnce(new Error('SYNTHETIC_NETWORK'));
  else api.put.mockResolvedValueOnce({ error: {}, response: { ok: false } });
  renderProbe();
  fireEvent.click(screen.getByText('Choose A'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The style changed on this device, but was not saved to your account. Choose a style again to retry.');
  expect(screen.getByText('Frame A')).toBeTruthy();
  expect(cookieStyle()).toBe('A');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  fireEvent.click(screen.getByText('Choose B'));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByText('Frame B')).toBeTruthy();
});
it.each(['same tab', 'broadcast'])('drops X waiting saves when Y signs in through %s', async (channel) => {
  let complete: ((value: unknown) => void) | undefined;
  api.put.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve; }));
  renderProbe();
  fireEvent.click(screen.getByText('Choose A'));
  fireEvent.click(screen.getByText('Choose B'));
  act(() => {
    if (channel === 'same tab') announceIdentityChange();
    else globalThis.dispatchEvent(new StorageEvent('storage', { key: 'pospay:identity-change', newValue: 'another-tab:1' }));
  });
  await act(async () => { complete?.(success); });
  fireEvent.click(screen.getByText('Choose C'));
  expect(screen.getByText('Frame C')).toBeTruthy();
  expect(api.put).toHaveBeenCalledTimes(1);
  expect(api.put.mock.calls[0]?.[1].signal.aborted).toBe(true);
});
