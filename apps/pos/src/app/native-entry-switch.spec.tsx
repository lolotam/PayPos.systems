import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readDeviceRole, readRememberedBusiness, rememberBusiness } from '@/app/device-role';
import { endPersonalSession } from '@/app/end-sessions';
import { usePersonalSession } from '@/personal-staff/api/use-personal-session';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { readLaunchLink } from '@/shared/platform/launch-links';

import { NativeEntry } from './native-entry';

const opened = vi.hoisted(() => ({ listener: null as ((url: string) => void) | null }));

vi.mock('@/app/device-role', () => ({
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
  DeviceScreen: () => <h2>device screen</h2>,
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: vi.fn(),
}));
vi.mock('@/personal-staff/ui/personal-screen', () => ({
  PersonalScreen: ({ workspace }: { workspace?: { company_id: string; business_id: string } }) => (
    <>
      <h2>personal screen</h2>
      {workspace ? <p>{`${workspace.company_id} ${workspace.business_id}`}</p> : null}
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
const THIRD_BUSINESS = '00000000-0000-4000-8000-000000000004';
const link = (host = HOST, business = BUSINESS) =>
  `https://${host}/personal?company=${COMPANY}&business=${business}`;

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
  vi.mocked(rememberBusiness).mockResolvedValue(undefined);
  vi.mocked(endPersonalSession).mockResolvedValue('done');
  vi.mocked(usePersonalSession).mockReturnValue({
    epoch: 0,
    online: true,
    loading: false,
    session: null,
    changed: vi.fn(),
    signOut: vi.fn(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** جهاز موظفة متذكر نشاط، ولينك لنشاط تاني. */
function anotherBusinessLink() {
  vi.mocked(readDeviceRole).mockResolvedValue('employee');
  vi.mocked(readRememberedBusiness).mockResolvedValue({
    company_id: COMPANY,
    business_id: BUSINESS,
  });
  vi.mocked(readLaunchLink).mockResolvedValue(link(HOST, OTHER_BUSINESS));
}

/** يفتح الشاشة بلينك نشاط تاني، وينتظر لحد ما لوحة التبديل تظهر. */
async function mountWithPanel() {
  anotherBusinessLink();
  mount();
  return screen.findByText(t('ar', 'nativeShell.switchBusinessConfirm'));
}

describe('NativeEntry business switch', () => {
  beforeEach(prepare);

  it('asks to switch and keeps the old business until the employee confirms', async () => {
    await mountWithPanel();

    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
    expect(rememberBusiness).not.toHaveBeenCalled();
  });

  it('signs out first and only then remembers the new business', async () => {
    const calls: string[] = [];
    vi.mocked(endPersonalSession).mockImplementation(async () => {
      calls.push('signOut');
      return 'done';
    });
    vi.mocked(rememberBusiness).mockImplementation(async () => {
      calls.push('remember');
    });
    await mountWithPanel();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') }));

    expect(await screen.findByText(`${COMPANY} ${OTHER_BUSINESS}`)).not.toBeNull();
    expect(screen.queryByText(`${COMPANY} ${BUSINESS}`)).toBeNull();
    expect(calls).toEqual(['signOut', 'remember']);
    expect(rememberBusiness).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: OTHER_BUSINESS,
    });
  });

  it('keeps the old business and the session when the employee cancels', async () => {
    await mountWithPanel();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.cancel') }));

    expect(screen.queryByText(t('ar', 'nativeShell.switchBusinessConfirm'))).toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
    expect(rememberBusiness).not.toHaveBeenCalled();
  });
});

describe('NativeEntry business switch that does not happen', () => {
  beforeEach(prepare);

  it('refuses the switch without the internet and changes nothing', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await mountWithPanel();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.roleChangeOffline'));
    expect(screen.getByText(t('ar', 'nativeShell.switchBusinessConfirm'))).not.toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
    expect(rememberBusiness).not.toHaveBeenCalled();
  });

  it('keeps the old business and says nothing changed when the sign-out is refused', async () => {
    vi.mocked(endPersonalSession).mockResolvedValue('failed');
    await mountWithPanel();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.roleChangeFailed'));
    expect(screen.getByText(t('ar', 'nativeShell.switchBusinessConfirm'))).not.toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(rememberBusiness).not.toHaveBeenCalled();
  });

  it('keeps the old business and warns when the new one cannot be stored', async () => {
    vi.mocked(rememberBusiness).mockRejectedValue(new Error('SYNTHETIC_SAVE_FAILURE'));
    await mountWithPanel();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(t('ar', 'nativeShell.saveFailed'));
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });

  it('drops the panel when a newer link names the business already open', async () => {
    await mountWithPanel();

    await act(async () => {
      opened.listener?.(link(HOST, BUSINESS));
    });

    await waitFor(() => {
      expect(screen.queryByText(t('ar', 'nativeShell.switchBusinessConfirm'))).toBeNull();
    });
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
    expect(endPersonalSession).not.toHaveBeenCalled();
    expect(rememberBusiness).not.toHaveBeenCalled();
  });
});

describe('NativeEntry cancelling a switch that did not happen', () => {
  beforeEach(prepare);

  it.each([
    { alertKey: 'nativeShell.roleChangeFailed', refused: true },
    { alertKey: 'nativeShell.roleChangeOffline', refused: false },
  ] as const)('cancelling clears the alert from $alertKey', async ({ alertKey, refused }) => {
    if (refused) {
      vi.mocked(endPersonalSession).mockResolvedValue('failed');
    } else {
      vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    }
    await mountWithPanel();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') }));
    expect((await screen.findByRole('alert')).textContent).toContain(t('ar', alertKey));
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.cancel') }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(t('ar', 'nativeShell.switchBusinessConfirm'))).toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });

  it('keeps an unrelated save failure after cancelling the switch', async () => {
    vi.mocked(rememberBusiness).mockRejectedValue(new Error('SYNTHETIC_SAVE_FAILURE'));
    await mountWithPanel();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.cancel') }));

    expect(screen.getByRole('alert').textContent).toContain(t('ar', 'nativeShell.saveFailed'));
    expect(screen.queryByText(t('ar', 'nativeShell.switchBusinessConfirm'))).toBeNull();
    expect(screen.getByText(`${COMPANY} ${BUSINESS}`)).not.toBeNull();
  });
});

describe('NativeEntry business switch with a newer link', () => {
  beforeEach(prepare);

  it('switches to the newest business when a second link names another one', async () => {
    await mountWithPanel();

    await act(async () => {
      opened.listener?.(link(HOST, THIRD_BUSINESS));
    });

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.confirm') }));

    expect(await screen.findByText(`${COMPANY} ${THIRD_BUSINESS}`)).not.toBeNull();
    expect(screen.queryByText(`${COMPANY} ${OTHER_BUSINESS}`)).toBeNull();
    expect(rememberBusiness).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: THIRD_BUSINESS,
    });
  });
});
