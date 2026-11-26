import { act, fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readDeviceRole } from '@/app/device-role';
import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as NativeShellModule from '@/shared/platform/native-shell';

import { NativeEntry } from './native-entry';
import { fetchMinVersionStatus, type MinVersionStatus } from './min-version/version-fetch';

const STORE_URL = 'https://apps.apple.com/app/id1';

const fakes = vi.hoisted(() => ({
  listener: null as ((isActive: boolean) => void) | null,
}));

vi.mock('@/app/device-role', () => ({
  clearDeviceRole: vi.fn(async () => undefined),
  readDeviceRole: vi.fn(async () => null),
  readRememberedBusiness: vi.fn(async () => null),
  saveDeviceRole: vi.fn(async () => undefined),
  rememberBusiness: vi.fn(async () => undefined),
  connectEmployee: vi.fn(async () => undefined),
}));
vi.mock('@/app/end-sessions', () => ({ endPersonalSession: vi.fn(async () => 'done') }));
// جلسة الجهاز: الشاشة اللي بتظهر مش موضوع الاختبار، بس لازم تفضل ثابتة.
vi.mock('@/device/api/use-device-session', () => ({
  useDeviceSession: () => ({
    screen: { kind: 'pairing', notice: null },
    submitting: false,
    retry: () => Promise.resolve(),
    submit: () => Promise.resolve(),
    startOver: () => Promise.resolve(),
  }),
}));
vi.mock('@/shared/platform/launch-links', () => ({
  readLaunchLink: vi.fn(async () => null),
  onLinkOpened: vi.fn(() => () => undefined),
}));
vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeShellModule>()),
  isNativeShell: vi.fn(() => true),
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
}));
vi.mock('./min-version/version-fetch', () => ({
  fetchMinVersionStatus: vi.fn(async () => null),
  onAppStateChange: vi.fn((listener: (isActive: boolean) => void) => {
    fakes.listener = listener;
    return () => undefined;
  }),
}));

function mount() {
  return render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <NativeEntry />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  fakes.listener = null;
  vi.mocked(readDeviceRole).mockResolvedValue(null);
  vi.mocked(fetchMinVersionStatus).mockResolvedValue(null);
});

describe('the update screen over the native flows', () => {
  it('covers the start screen when the read needs an update (VER-T05)', async () => {
    vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'blocked', storeUrl: STORE_URL });

    mount();

    expect(await screen.findByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeDefined();
    expect(screen.queryByText(t('ar', 'nativeShell.title'))).toBeNull();
    const link = screen.getByRole('link', { name: t('ar', 'nativeShell.mustUpdateButton') });
    expect(link.getAttribute('href')).toBe(STORE_URL);
  });

  it('covers the counter flow when the read needs an update (VER-T05)', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('counter');
    vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'blocked', storeUrl: STORE_URL });

    mount();

    expect(await screen.findByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeDefined();
    expect(screen.queryByText(t('ar', 'pos.pairingTitle'))).toBeNull();
  });

  it('shows the counter flow when the read does not need an update (VER-T05)', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('counter');
    vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'ok' });

    mount();

    expect(await screen.findByText(t('ar', 'pos.pairingTitle'))).toBeDefined();
    expect(screen.queryByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeNull();
  });

  it('covers the employee flow when the read needs an update (VER-T05)', async () => {
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'blocked', storeUrl: STORE_URL });

    mount();

    expect(await screen.findByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeDefined();
    expect(screen.queryByText(t('ar', 'personalStaff.title'))).toBeNull();
  });

  it('opens the normal start screen when the file cannot be read (VER-T07)', async () => {
    vi.mocked(fetchMinVersionStatus).mockResolvedValue(null);

    mount();

    expect(await screen.findByText(t('ar', 'nativeShell.title'))).toBeDefined();
    expect(screen.queryByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeNull();
  });

  it('opens the normal start screen after a restart with an unreadable file (VER-T06)', async () => {
    vi.mocked(fetchMinVersionStatus).mockResolvedValue({ outcome: 'blocked', storeUrl: STORE_URL });
    const first = mount();
    expect(await screen.findByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeDefined();
    first.unmount();

    vi.mocked(fetchMinVersionStatus).mockResolvedValue(null);
    mount();

    expect(await screen.findByText(t('ar', 'nativeShell.title'))).toBeDefined();
    expect(screen.queryByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeNull();
  });
});

describe('the update check after a return from the background (FR-001a)', () => {
  beforeEach(() => {
    vi.mocked(readDeviceRole).mockResolvedValue('counter');
  });

  it('keeps the code the user typed when the app comes back from the background', async () => {
    const answers: ((status: MinVersionStatus | null) => void)[] = [];
    vi.mocked(fetchMinVersionStatus).mockImplementation(
      () =>
        new Promise<MinVersionStatus | null>((resolve) => {
          answers.push(resolve);
        }),
    );

    mount();

    // فحص البداية البارد خلص من غير تحديث، فشاشة الكاونتر بتفتح.
    await act(async () => {
      answers[0]?.({ outcome: 'ok' });
    });
    const field = await screen.findByLabelText(t('ar', 'pos.pairingCodeLabel'));
    fireEvent.change(field, { target: { value: 'A1B2' } });

    // الرجوع للقدام وبعدين رجوع تاني، والفحص الجديد لسه شغال.
    await act(async () => {
      fakes.listener?.(false);
    });
    await act(async () => {
      fakes.listener?.(true);
    });

    // الشاشة ما اتفصلتش: نفس العنصر ونفس النص، من غير إشعار تحميل.
    expect(screen.queryAllByText(t('ar', 'pos.loading'))).toHaveLength(0);
    const sameField = screen.getByLabelText(t('ar', 'pos.pairingCodeLabel'));
    expect(sameField).toBe(field);
    expect((sameField as HTMLInputElement).value).toBe('A1B2');

    // السيرفر ردّ إن التطبيق محتاج تحديث.
    await act(async () => {
      answers[1]?.({ outcome: 'blocked', storeUrl: STORE_URL });
    });

    expect(await screen.findByText(t('ar', 'nativeShell.mustUpdateTitle'))).toBeDefined();
  });
});
