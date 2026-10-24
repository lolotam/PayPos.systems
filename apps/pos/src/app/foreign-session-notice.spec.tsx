import { act, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { endPersonalSession } from '@/app/end-sessions';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { ForeignSessionNotice } from './foreign-session-notice';

vi.mock('@/app/end-sessions', () => ({
  endPersonalSession: vi.fn(),
}));

const KEY = 'session-key';

function mount(outcome: 'running' | 'failed' | undefined) {
  const onOutcome = vi.fn();
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <ForeignSessionNotice sessionKey={KEY} outcome={outcome} onOutcome={onOutcome} />
    </LocaleProvider>,
  );
  return { onOutcome };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(endPersonalSession).mockResolvedValue('done');
});

describe('ForeignSessionNotice', () => {
  it('ends the session once when it mounts for a session nobody tried yet', async () => {
    const { onOutcome } = mount(undefined);

    expect(await screen.findByRole('status')).not.toBeNull();
    expect(endPersonalSession).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith(KEY, 'running');
  });

  it('keeps the alert and the retry when the session was already refused', async () => {
    mount('failed');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.roleChangeFailed'));
    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.retry') })).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
  });

  it('ends the session again when the employee asks and locks the button while it runs', async () => {
    let release!: (result: 'done' | 'failed') => void;
    vi.mocked(endPersonalSession).mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    mount('failed');

    const retry = screen.getByRole('button', { name: t('ar', 'nativeShell.retry') });
    fireEvent.click(retry);

    expect(endPersonalSession).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(true);

    await act(async () => {
      release('failed');
    });

    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
