import { t } from '@pospay/i18n';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TwoFactorGate } from './two-factor-gate';

const session = vi.hoisted(() => ({ read: vi.fn() }));
const nav = vi.hoisted(() => ({ redirect: vi.fn() }));

vi.mock('@/session/api/server-session', () => ({ readSession: () => session.read() }));
vi.mock('next/navigation', () => ({
  redirect: (path: string) => {
    nav.redirect(path);
    throw new Error('NEXT_REDIRECT');
  },
}));
vi.mock('@/session/ui/session-unavailable', () => ({
  SessionUnavailable: () => <p role="alert">Session unavailable</p>,
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

beforeEach(() => {
  session.read.mockReset();
  nav.redirect.mockReset();
});

describe('the Authenticator page gate', () => {
  it('sends a visitor with no session to sign in', async () => {
    session.read.mockResolvedValue({ kind: 'anonymous' });
    await expect(TwoFactorGate()).rejects.toThrow('NEXT_REDIRECT');
    expect(nav.redirect).toHaveBeenCalledWith('/login');
  });

  it('shows the unavailable screen when the session cannot be read', async () => {
    session.read.mockResolvedValue({ kind: 'error' });
    render(await TwoFactorGate());
    expect(screen.getByRole('alert').textContent).toBe('Session unavailable');
    expect(screen.queryByRole('heading', { name: t('en', 'admin.enrolTitle') })).toBeNull();
  });

  it('draws the password step for a signed-in user', async () => {
    session.read.mockResolvedValue({ kind: 'signed-in' });
    render(await TwoFactorGate());
    expect(screen.getByRole('heading', { level: 1, name: t('en', 'admin.enrolTitle') })).toBeTruthy();
    expect(screen.getByText(t('en', 'admin.enrolPasswordLead'))).toBeTruthy();
  });
});
