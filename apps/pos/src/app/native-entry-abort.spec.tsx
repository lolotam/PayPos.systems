import { act, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearDeviceRole, readDeviceRole, readRememberedBusiness } from '@/app/device-role';
import { endPersonalSession } from '@/app/end-sessions';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { readLaunchLink } from '@/shared/platform/launch-links';

import { NativeEntry } from './native-entry';
import { START_OVER_SIGN_OUT_WAIT_MS } from './link-rules';

vi.mock('@/app/device-role', () => ({
  clearDeviceRole: vi.fn(),
  readDeviceRole: vi.fn(),
  readRememberedBusiness: vi.fn(),
  saveDeviceRole: vi.fn(),
  rememberBusiness: vi.fn(),
  connectEmployee: vi.fn(),
}));
vi.mock('@/app/end-sessions', () => ({
  endPersonalSession: vi.fn(),
}));
vi.mock('@/app/device-screen', () => ({
  DeviceScreen: ({ startOver }: { startOver?: ReactNode }) => <>{startOver}</>,
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: vi.fn(),
}));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: ({ startOver }: { startOver?: ReactNode }) => (
    <>
      <h2>personal screen</h2>
      {startOver}
    </>
  ),
}));
vi.mock('@/shared/platform/launch-links', () => ({
  readLaunchLink: vi.fn(),
  onLinkOpened: vi.fn(() => () => undefined),
}));
vi.mock('@/shared/platform/native-shell', () => ({
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
}));

function mount() {
  render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <NativeEntry />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

function prepare() {
  vi.clearAllMocks();
  vi.mocked(readRememberedBusiness).mockResolvedValue(null);
  vi.mocked(readLaunchLink).mockResolvedValue(null);
  vi.mocked(endPersonalSession).mockResolvedValue('done');
}

/** الرجوع للموظفة: تضغط الزر وبعدين تستنى مهلة إنهاء الجلسة. */
async function backFromEmployee() {
  expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.startOver') }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(START_OVER_SIGN_OUT_WAIT_MS);
  });
  vi.useRealTimers();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the back step and the stalled sign-out', () => {
  beforeEach(prepare);

  it('aborts the stalled sign-out and keeps the employee on her screen when the answer comes late', async () => {
    let received: AbortSignal | undefined;
    let resolveLate: (value: 'done' | 'failed') => void = () => undefined;
    vi.mocked(endPersonalSession).mockImplementation((signal?: AbortSignal) => {
      received = signal;
      return new Promise<'done' | 'failed'>((resolve) => {
        resolveLate = resolve;
      });
    });
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    mount();
    await backFromEmployee();

    expect(received).toBeInstanceOf(AbortSignal);
    expect(received?.aborted).toBe(true);
    const message = await screen.findByRole('alert');
    expect(message.textContent).toContain(t('ar', 'nativeShell.roleChangeFailed'));
    expect(screen.getByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();

    // الرد المتأخر بعد الإلغاء ما يكملش الرجوع ولا يمس جلسة أحدث.
    await act(async () => {
      resolveLate('done');
    });

    expect(screen.getByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();
    expect(clearDeviceRole).not.toHaveBeenCalled();
  });
});
