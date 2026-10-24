import { act, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { useCallback, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { endPersonalSession } from '@/app/end-sessions';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { FOREIGN_SIGN_OUT_WAIT_MS, ForeignSessionNotice } from './foreign-session-notice';

vi.mock('@/app/end-sessions', () => ({
  endPersonalSession: vi.fn(),
}));

const KEY = 'session-key';

function mount(initialOutcome: 'running' | 'failed' | undefined) {
  const onOutcome = vi.fn();
  function ControlledNotice() {
    const [outcome, setOutcome] = useState(initialOutcome);
    const report = useCallback(
      (key: string, next: 'running' | 'failed') => {
        onOutcome(key, next);
        setOutcome(next);
      },
      [onOutcome],
    );
    return <ForeignSessionNotice sessionKey={KEY} outcome={outcome} onOutcome={report} />;
  }
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <ControlledNotice />
    </LocaleProvider>,
  );
  return { onOutcome };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(endPersonalSession).mockResolvedValue('done');
});

afterEach(() => {
  vi.useRealTimers();
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
      () =>
        new Promise((resolve) => {
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

  it('shows an enabled retry after a sign-out never answers for ten seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(endPersonalSession).mockReturnValue(
      new Promise<'done' | 'failed'>(() => undefined),
    );
    mount(undefined);

    expect(screen.getByRole('status')).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(FOREIGN_SIGN_OUT_WAIT_MS - 1);
    });
    expect(screen.getByRole('status')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByRole('alert').textContent).toContain(
      t('ar', 'nativeShell.roleChangeFailed'),
    );
    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('times out a successful answer while the same session notice stays mounted', async () => {
    vi.useFakeTimers();
    mount(undefined);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole('status')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(FOREIGN_SIGN_OUT_WAIT_MS);
    });

    expect(screen.getByRole('alert').textContent).toContain(
      t('ar', 'nativeShell.roleChangeFailed'),
    );
    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('ignores a successful answer that arrives after the wait', async () => {
    vi.useFakeTimers();
    let release!: (result: 'done' | 'failed') => void;
    vi.mocked(endPersonalSession).mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    mount(undefined);

    await act(async () => {
      vi.advanceTimersByTime(FOREIGN_SIGN_OUT_WAIT_MS);
    });
    expect(screen.getByRole('alert')).not.toBeNull();

    await act(async () => {
      release('done');
      await Promise.resolve();
    });

    expect(screen.getByRole('alert').textContent).toContain(
      t('ar', 'nativeShell.roleChangeFailed'),
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(false);
  });

  it('unlocks retry after a retry also never answers for ten seconds', async () => {
    vi.useFakeTimers();
    vi.mocked(endPersonalSession).mockReturnValue(
      new Promise<'done' | 'failed'>(() => undefined),
    );
    mount('failed');

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }));
    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(true);
    expect(screen.getByRole('alert')).not.toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(FOREIGN_SIGN_OUT_WAIT_MS);
    });

    expect(screen.getByRole('alert').textContent).toContain(
      t('ar', 'nativeShell.roleChangeFailed'),
    );
    expect(
      screen.getByRole('button', { name: t('ar', 'nativeShell.retry') }).hasAttribute('disabled'),
    ).toBe(false);
  });
});
