import { StrictMode, type ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { t } from '@pospay/i18n';

import type * as deviceRoleModule from '@/app/device-role';
import {
  connectEmployee,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
  saveDeviceRole,
} from '@/app/device-role';
import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as nativeShellModule from '@/shared/platform/native-shell';

import { NativeEntry } from './native-entry';

const app = vi.hoisted(() => ({
  getLaunchUrl: vi.fn<() => Promise<{ url?: string }>>(),
  opened: null as ((event: { url: string }) => void) | null,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getLaunchUrl: app.getLaunchUrl,
    addListener: (_event: 'appUrlOpen', listener: (event: { url: string }) => void) => {
      app.opened = listener;
      return Promise.resolve({ remove: vi.fn() });
    },
  },
}));
vi.mock('@/app/device-role', async (importOriginal) => ({
  ...(await importOriginal<typeof deviceRoleModule>()),
  readDeviceRole: vi.fn(),
  readRememberedBusiness: vi.fn(),
  saveDeviceRole: vi.fn(),
  rememberBusiness: vi.fn(),
  clearDeviceRole: vi.fn(),
  connectEmployee: vi.fn(),
}));
vi.mock('@/app/end-sessions', () => ({
  endPersonalSession: vi.fn(async () => 'done' as const),
}));
vi.mock('@/app/device-screen', () => ({
  DeviceScreen: ({ notice }: { notice?: ReactNode }) => (
    <>
      <h2>device screen</h2>
      {notice}
    </>
  ),
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: () => ({
    epoch: 0,
    online: true,
    loading: false,
    confirmedNoSession: true,
    session: null,
    changed: vi.fn(),
    signOut: vi.fn(),
  }),
}));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: ({
    workspace,
    connect,
    notice,
  }: {
    workspace?: { company_id: string; business_id: string };
    connect?: ReactNode;
    notice?: ReactNode;
  }) => (
    <>
      <h2>personal screen</h2>
      {workspace ? <p>{`${workspace.company_id} ${workspace.business_id}`}</p> : null}
      {connect}
      {notice}
    </>
  ),
}));
vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof nativeShellModule>()),
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
  nativeShell: () => true,
  capabilities: () => ({
    nativeShell: true,
    camera: false,
    qrScan: false,
    push: true,
    biometrics: false,
    haptics: false,
    offlineStore: true,
  }),
}));

const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const OTHER_BUSINESS = '00000000-0000-4000-8000-000000000003';
const LAUNCH_URL = `https://pos.staging.pospay.systems/personal?company=${COMPANY}&business=${BUSINESS}`;
const OTHER_LAUNCH_URL = `https://pos.staging.pospay.systems/personal?company=${COMPANY}&business=${OTHER_BUSINESS}`;

beforeEach(() => {
  vi.clearAllMocks();
  app.opened = null;
  window.sessionStorage.clear();
  vi.mocked(readDeviceRole).mockResolvedValue('employee');
  vi.mocked(readRememberedBusiness).mockResolvedValue(null);
  vi.mocked(saveDeviceRole).mockResolvedValue(undefined);
  vi.mocked(connectEmployee).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useNativeLink queued cold link cancellation', () => {
  it('cancels an already queued cold link once a pending paste step succeeds', async () => {
    let releaseLaunch!: (value: { url?: string }) => void;
    let releaseSave!: () => void;
    app.getLaunchUrl.mockImplementation(
      () =>
        new Promise<{ url?: string }>((resolve) => {
          releaseLaunch = resolve;
        }),
    );
    vi.mocked(rememberBusiness).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        }),
    );
    render(
      <StrictMode>
        <LocaleProvider locale="ar" setLocale={vi.fn()}>
          <NativeEntry />
        </LocaleProvider>
      </StrictMode>,
    );
    await vi.waitFor(() => expect(app.opened).not.toBeNull());
    await act(async () => {
      app.opened?.({ url: 'https://pos.staging.pospay.systems/bad' });
    });

    const input = await screen.findByLabelText(t('ar', 'nativeShell.pasteLabel'));
    fireEvent.change(input, { target: { value: OTHER_LAUNCH_URL } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.pasteSubmit') }));
    await vi.waitFor(() => expect(rememberBusiness).toHaveBeenCalledTimes(1));

    await act(async () => {
      releaseLaunch({ url: LAUNCH_URL });
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      releaseSave();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText(`${COMPANY} ${OTHER_BUSINESS}`)).not.toBeNull();
    expect(screen.queryByText(t('ar', 'nativeShell.switchBusinessConfirm'))).toBeNull();
    expect(screen.queryByText(`${COMPANY} ${BUSINESS}`)).toBeNull();
    expect(window.sessionStorage.getItem('pospay.native.launchUrl')).not.toBeNull();
  });
});

describe('useNativeLink queued cold link after failed paste', () => {
  it('keeps an already queued cold link eligible when the pending paste fails with saveFailed', async () => {
    let releaseLaunch!: (value: { url?: string }) => void;
    let failSave!: () => void;
    app.getLaunchUrl.mockImplementation(
      () =>
        new Promise<{ url?: string }>((resolve) => {
          releaseLaunch = resolve;
        }),
    );
    vi.mocked(rememberBusiness)
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failSave = () => reject(new Error('SYNTHETIC_SAVE_FAILURE'));
          }),
      )
      .mockResolvedValueOnce(undefined);
    render(
      <StrictMode>
        <LocaleProvider locale="ar" setLocale={vi.fn()}>
          <NativeEntry />
        </LocaleProvider>
      </StrictMode>,
    );
    await vi.waitFor(() => expect(app.opened).not.toBeNull());
    await act(async () => {
      app.opened?.({ url: 'https://pos.staging.pospay.systems/bad' });
    });

    const input = await screen.findByLabelText(t('ar', 'nativeShell.pasteLabel'));
    fireEvent.change(input, { target: { value: OTHER_LAUNCH_URL } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.pasteSubmit') }));
    await vi.waitFor(() => expect(rememberBusiness).toHaveBeenCalledTimes(1));

    await act(async () => {
      releaseLaunch({ url: LAUNCH_URL });
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      failSave();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(await screen.findByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(window.sessionStorage.getItem('pospay.native.launchUrl')).not.toBeNull();
  });
});
