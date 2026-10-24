import { act, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearDeviceRole,
  connectEmployee,
  readDeviceRole,
  readRememberedBusiness,
  rememberBusiness,
  saveDeviceRole,
  type DeviceRole,
} from '@/app/device-role';
import { endPersonalSession } from '@/app/end-sessions';
import { usePersonalSession } from '@/personal-staff/api/use-personal-session';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { readLaunchLink } from '@/shared/platform/launch-links';

import { NativeEntry } from './native-entry';
import { START_OVER_SIGN_OUT_WAIT_MS } from './link-rules';

const opened = vi.hoisted(() => ({ listener: null as ((url: string) => void) | null }));

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
  DeviceScreen: ({ startOver }: { startOver?: ReactNode }) => (
    <>
      <h2>device screen</h2>
      {startOver}
    </>
  ),
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: vi.fn(),
}));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: ({
    workspace,
    startOver,
  }: {
    workspace?: { company_id: string; business_id: string };
    startOver?: ReactNode;
  }) => (
    <>
      <h2>personal screen</h2>
      {workspace ? <p>{`${workspace.company_id} ${workspace.business_id}`}</p> : null}
      {startOver}
    </>
  ),
}));
vi.mock('@/shared/platform/launch-links', () => ({
  readLaunchLink: vi.fn(),
  onLinkOpened: vi.fn((listener: (url: string) => void) => {
    opened.listener = listener;
    return () => undefined;
  }),
}));
vi.mock('@/shared/platform/native-shell', () => ({
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
}));

const HOST = 'pos.staging.pospay.systems';
const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';
const OTHER_BUSINESS = '00000000-0000-4000-8000-000000000003';
const link = (host = HOST, business = BUSINESS) =>
  `https://${host}/personal?company=${COMPANY}&business=${business}`;

const roles = [
  { role: 'counter', button: 'nativeShell.counter', heading: 'device screen' },
  { role: 'employee', button: 'nativeShell.employee', heading: 'personal screen' },
] as const;

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
  opened.listener = null;
  vi.mocked(readDeviceRole).mockResolvedValue(null);
  vi.mocked(readRememberedBusiness).mockResolvedValue(null);
  vi.mocked(readLaunchLink).mockResolvedValue(null);
  vi.mocked(clearDeviceRole).mockResolvedValue(undefined);
  vi.mocked(saveDeviceRole).mockResolvedValue(undefined);
  vi.mocked(rememberBusiness).mockResolvedValue(undefined);
  vi.mocked(connectEmployee).mockResolvedValue(undefined);
  vi.mocked(endPersonalSession).mockResolvedValue('done');
  vi.mocked(usePersonalSession).mockReturnValue({
    epoch: 0,
    online: true,
    loading: false,
    confirmedNoSession: true,
    session: null,
    changed: vi.fn(),
    signOut: vi.fn(),
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('NativeEntry start screen', () => {
  beforeEach(prepare);

  it('shows the start screen when no role is stored yet', async () => {
    mount();

    expect(
      await screen.findByRole('heading', { name: t('ar', 'nativeShell.title') }),
    ).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'device screen' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'personal screen' })).toBeNull();
    expect(usePersonalSession).not.toHaveBeenCalled();
  });

  it.each(roles)(
    'opens the $role flow directly when the role is stored',
    async ({ role, heading }) => {
      vi.mocked(readDeviceRole).mockResolvedValue(role);
      mount();

      expect(await screen.findByRole('heading', { name: heading })).not.toBeNull();
      expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();
    },
  );

  it('never reads the personal session on a counter device', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('counter');
    mount();

    expect(await screen.findByRole('heading', { name: 'device screen' })).not.toBeNull();
    expect(usePersonalSession).not.toHaveBeenCalled();
  });

  it('shows the loading notice while the stored role is being read', () => {
    vi.mocked(readDeviceRole).mockReturnValue(new Promise<DeviceRole | null>(() => undefined));
    mount();

    expect(screen.getByRole('status')).not.toBeNull();
    expect(screen.getByText(t('ar', 'pos.loading'))).not.toBeNull();
    expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();
  });
});

describe('NativeEntry role choice', () => {
  beforeEach(prepare);

  it.each(roles)('saves the $role choice and opens its flow', async ({ role, button, heading }) => {
    mount();

    fireEvent.click(await screen.findByRole('button', { name: t('ar', button) }));

    expect(await screen.findByRole('heading', { name: heading })).not.toBeNull();
    expect(saveDeviceRole).toHaveBeenCalledWith(role);
  });

  it('keeps the start screen and warns when the choice cannot be saved', async () => {
    vi.mocked(saveDeviceRole).mockRejectedValue(new Error('SYNTHETIC_SAVE_FAILURE'));
    mount();

    fireEvent.click(await screen.findByRole('button', { name: t('ar', 'nativeShell.counter') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.saveFailed'));
    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
  });

  it('stores nothing and asks for the internet when the choice is made offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    mount();

    fireEvent.click(await screen.findByRole('button', { name: t('ar', 'nativeShell.employee') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.needsInternet'));
    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: 'device screen' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'personal screen' })).toBeNull();
    expect(saveDeviceRole).not.toHaveBeenCalled();
  });
});

describe('NativeEntry link on a cold start', () => {
  beforeEach(prepare);

  it('opens the employee flow with the business of a launch link on a fresh install', async () => {
    vi.mocked(readLaunchLink).mockResolvedValue(link());
    mount();

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(connectEmployee).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });

  it('warns that the choice could not be saved when the link cannot be stored', async () => {
    vi.mocked(readLaunchLink).mockResolvedValue(link());
    vi.mocked(connectEmployee).mockRejectedValue(new Error('SYNTHETIC_SAVE_FAILURE'));
    mount();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.saveFailed'));
    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
  });

  it('keeps the counter device and says the link is for an employee', async () => {
    vi.mocked(readLaunchLink).mockResolvedValue(link());
    vi.mocked(readDeviceRole).mockResolvedValue('counter');
    mount();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.counterDevice'));
    expect(screen.getByRole('heading', { name: 'device screen' })).not.toBeNull();
    expect(connectEmployee).not.toHaveBeenCalled();
  });

  it('stores nothing and asks for the internet when a link arrives offline', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    vi.mocked(readLaunchLink).mockResolvedValue(link());
    mount();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.needsInternet'));
    expect(screen.getByRole('heading', { name: t('ar', 'nativeShell.title') })).not.toBeNull();
    expect(connectEmployee).not.toHaveBeenCalled();
    expect(rememberBusiness).not.toHaveBeenCalled();
  });

  it('changes nothing for a foreign link and asks the manager', async () => {
    vi.mocked(readLaunchLink).mockResolvedValue(link('pos.example.com'));
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    vi.mocked(readRememberedBusiness).mockResolvedValue({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    mount();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'personalStaff.linkRequired'));
    expect(connectEmployee).not.toHaveBeenCalled();
    expect(rememberBusiness).not.toHaveBeenCalled();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });
});

describe('NativeEntry link while the app runs', () => {
  beforeEach(prepare);

  it('takes the same link while the app runs', async () => {
    mount();
    expect(
      await screen.findByRole('heading', { name: t('ar', 'nativeShell.title') }),
    ).not.toBeNull();

    await act(async () => {
      opened.listener?.(link());
    });

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(connectEmployee).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });

  it('asks to switch and keeps the remembered business when the link is for another one', async () => {
    vi.mocked(readLaunchLink).mockResolvedValue(link(HOST, OTHER_BUSINESS));
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    vi.mocked(readRememberedBusiness).mockResolvedValue({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    mount();

    expect(await screen.findByText(t('ar', 'nativeShell.switchBusinessConfirm'))).not.toBeNull();
    expect(rememberBusiness).not.toHaveBeenCalled();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });
});

describe('NativeEntry remembered business', () => {
  beforeEach(prepare);

  it('remembers the business of a link on an employee device without a business', async () => {
    vi.mocked(readLaunchLink).mockResolvedValue(link());
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    mount();

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(rememberBusiness).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    expect(connectEmployee).not.toHaveBeenCalled();
  });

  it('stores nothing when the link is for the remembered business', async () => {
    vi.mocked(readLaunchLink).mockResolvedValue(link());
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    vi.mocked(readRememberedBusiness).mockResolvedValue({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    mount();

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(rememberBusiness).not.toHaveBeenCalled();
    expect(connectEmployee).not.toHaveBeenCalled();
  });

  it('opens the employee flow with the remembered business', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    vi.mocked(readRememberedBusiness).mockResolvedValue({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    mount();

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });
});

async function backFrom(role: DeviceRole, waitMs?: number) {
  const heading = role === 'counter' ? 'device screen' : 'personal screen';
  expect(await screen.findByRole('heading', { name: heading })).not.toBeNull();
  if (waitMs !== undefined) vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.startOver') }));
  if (waitMs !== undefined) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(waitMs);
    });
    vi.useRealTimers();
  }
}

describe('back to the device choice (FR-001)', () => {
  beforeEach(prepare);

  it.each(roles)('returns from the $role flow to the start screen', async ({ role, heading }) => {
    vi.mocked(readDeviceRole).mockResolvedValue(role);
    mount();
    await backFrom(role);

    expect(
      await screen.findByRole('button', { name: t('ar', 'nativeShell.counter') }),
    ).not.toBeNull();
    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.employee') })).not.toBeNull();
    expect(screen.queryByRole('heading', { name: heading })).toBeNull();
    expect(clearDeviceRole).toHaveBeenCalledTimes(1);
    expect(endPersonalSession).toHaveBeenCalledTimes(role === 'employee' ? 1 : 0);
  });

  it('keeps the remembered business after going back and choosing employee again', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    vi.mocked(readRememberedBusiness).mockResolvedValue({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    mount();
    await backFrom('employee');
    fireEvent.click(await screen.findByRole('button', { name: t('ar', 'nativeShell.employee') }));

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });
});

describe('back to the device choice refused safely', () => {
  beforeEach(prepare);
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { mode: 'failed', alert: 'nativeShell.roleChangeFailed', endings: 1 },
    { mode: 'offline', alert: 'nativeShell.roleChangeOffline', endings: 0 },
    { mode: 'timeout', alert: 'nativeShell.roleChangeFailed', endings: 1 },
  ] as const)(
    'keeps the employee flow when sign-out is $mode',
    async ({ mode, alert, endings }) => {
      if (mode === 'failed') vi.mocked(endPersonalSession).mockResolvedValue('failed');
      else if (mode === 'offline')
        vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
      else vi.mocked(endPersonalSession).mockReturnValue(new Promise<never>(() => undefined));
      vi.mocked(readDeviceRole).mockResolvedValue('employee');
      mount();
      await backFrom('employee', mode === 'timeout' ? START_OVER_SIGN_OUT_WAIT_MS : undefined);

      const message = await screen.findByRole('alert');
      expect(message.textContent).toContain(t('ar', alert));
      expect(screen.getByRole('heading', { name: 'personal screen' })).not.toBeNull();
      expect(screen.queryByRole('heading', { name: t('ar', 'nativeShell.title') })).toBeNull();
      expect(clearDeviceRole).not.toHaveBeenCalled();
      expect(endPersonalSession).toHaveBeenCalledTimes(endings);
    },
  );

  it('does not clear the role when the remembered business cannot be read', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('counter');
    vi.mocked(readRememberedBusiness)
      .mockResolvedValueOnce(null)
      .mockRejectedValue(new Error('SYNTHETIC_READ_FAILURE'));
    mount();
    await backFrom('counter');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.saveFailed'));
    expect(screen.getByRole('heading', { name: 'device screen' })).not.toBeNull();
    expect(clearDeviceRole).not.toHaveBeenCalled();
  });
});

describe('a manager link after back to the device choice', () => {
  beforeEach(prepare);

  it('handles the link with no role as on a first launch', async () => {
    vi.mocked(readDeviceRole).mockResolvedValueOnce('employee').mockResolvedValue(null);
    mount();
    await backFrom('employee');
    expect(
      await screen.findByRole('heading', { name: t('ar', 'nativeShell.title') }),
    ).not.toBeNull();

    await act(async () => {
      opened.listener?.(link());
    });

    expect(await screen.findByRole('heading', { name: 'personal screen' })).not.toBeNull();
    expect(connectEmployee).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    expect(rememberBusiness).not.toHaveBeenCalled();
  });
});
