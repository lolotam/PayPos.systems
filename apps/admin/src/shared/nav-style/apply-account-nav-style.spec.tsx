import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearNavStyleCookie } from './nav-style-cookie';
import { SignInStyleProbe } from './sign-in-style-probe.fixture';

const mocks = vi.hoisted(() => ({ get: vi.fn(), loadPage: vi.fn(), announceIdentityChange: vi.fn(),
  signInWithPassword: vi.fn(), verifyTotpCode: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: mocks.get }) }));
vi.mock('@/shared/browser/load-page', () => ({ loadPage: mocks.loadPage, announceIdentityChange: mocks.announceIdentityChange }));
vi.mock('@/session/api/session-calls', () => mocks);
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const cookieStyle = () => document.cookie.split('; ').find((v) => v.startsWith('pospay_nav_style='))?.split('=')[1];
let atNavigation: string | undefined;
beforeEach(() => {
  vi.resetAllMocks();
  document.cookie = 'pospay_nav_style=B; Path=/';
  atNavigation = 'not navigated';
  mocks.loadPage.mockImplementation(() => { atNavigation = cookieStyle(); });
  mocks.signInWithPassword.mockResolvedValue('done');
  mocks.verifyTotpCode.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); clearNavStyleCookie(); });

describe.each(['password', 'totp'] as const)('%s account style before navigation', (kind) => {
  it.each(['A', null, 'D', undefined])('applies %s or clears malformed/unset before one navigation', async (navStyle) => {
    mocks.get.mockResolvedValue({ data: navStyle === undefined ? {} : { navStyle }, response: { ok: true } });
    render(<SignInStyleProbe kind={kind} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.loadPage).toHaveBeenCalledTimes(1));
    expect(atNavigation).toBe(navStyle === 'A' ? 'A' : undefined);
    expect(mocks.loadPage).toHaveBeenCalledWith('/');
    expect(mocks.get.mock.calls[0]?.[1]).toMatchObject({ cache: 'no-store' });
    expect(mocks.announceIdentityChange.mock.invocationCallOrder[0]).toBeLessThan(mocks.get.mock.invocationCallOrder[0] ?? 0);
  });
  it.each(['refusal', 'network'])('clears the previous style after %s', async (failure) => {
    if (failure === 'network') mocks.get.mockRejectedValue(new Error('SYNTHETIC_NETWORK'));
    else mocks.get.mockResolvedValue({ error: {}, response: { ok: false } });
    render(<SignInStyleProbe kind={kind} />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(mocks.loadPage).toHaveBeenCalledTimes(1));
    expect(atNavigation).toBeUndefined();
  });
  it.each(['transport', 'body'])('keeps submit disabled through the whole %s deadline and ignores a late success', async () => {
    vi.useFakeTimers();
    let complete: ((value: unknown) => void) | undefined;
    mocks.get.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    render(<SignInStyleProbe kind={kind} />);
    fireEvent.click(screen.getByRole('button'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    expect(mocks.loadPage).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(atNavigation).toBeUndefined();
    expect(mocks.loadPage).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
    await act(async () => { complete?.({ data: { navStyle: 'A' }, response: { ok: true } }); });
    expect(cookieStyle()).toBeUndefined();
    expect(mocks.loadPage).toHaveBeenCalledTimes(1);
  });
});
it.each(['totp', 'admin.unexpected'])('does not read on the password outcome %s', async (outcome) => {
  mocks.signInWithPassword.mockResolvedValue(outcome);
  render(<SignInStyleProbe kind="password" />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(screen.getByRole('button').hasAttribute('disabled')).toBe(false));
  expect(cookieStyle()).toBe('B');
  expect(mocks.get).not.toHaveBeenCalled();
  expect(mocks.announceIdentityChange).not.toHaveBeenCalled();
});
it('does not read after a refused second factor', async () => {
  mocks.verifyTotpCode.mockResolvedValue('admin.codeInvalid');
  render(<SignInStyleProbe kind="totp" />);
  fireEvent.click(screen.getByRole('button'));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'admin.codeInvalid');
  expect(cookieStyle()).toBe('B');
  expect(mocks.get).not.toHaveBeenCalled();
});
