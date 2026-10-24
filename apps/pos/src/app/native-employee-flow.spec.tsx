import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readDeviceRole, rememberBusiness } from '@/app/device-role';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { NativeEntry } from './native-entry';

vi.mock('@/app/device-role', () => ({
  readDeviceRole: vi.fn(),
  readRememberedBusiness: vi.fn(async () => null),
  saveDeviceRole: vi.fn(),
  rememberBusiness: vi.fn(),
  connectEmployee: vi.fn(),
}));
vi.mock('@/shared/platform/launch-links', () => ({
  readLaunchLink: vi.fn(async () => null),
  onLinkOpened: vi.fn(() => () => undefined),
}));
vi.mock('@/shared/platform/native-shell', () => ({
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
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

const HOST = 'pos.staging.pospay.systems';
const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';

function mount() {
  render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        <NativeEntry />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

describe('NativeEntry employee flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    window.history.replaceState({}, '', '/');
  });

  it('asks the manager for the link and shows no identifier field', async () => {
    mount();

    expect(await screen.findByText(t('ar', 'personalStaff.linkRequired'))).not.toBeNull();
    const field = screen.getByLabelText(t('ar', 'nativeShell.pasteLabel'));
    expect(field.getAttribute('type')).toBe('url');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('connects the business of a pasted manager link and opens the personal sign-in', async () => {
    mount();

    const field = await screen.findByLabelText(t('ar', 'nativeShell.pasteLabel'));
    fireEvent.change(field, {
      target: { value: `https://${HOST}/personal?company=${COMPANY}&business=${BUSINESS}` },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.pasteSubmit') }));

    expect(await screen.findByLabelText(t('ar', 'staffLogin.phone'))).not.toBeNull();
    expect(screen.queryByText(t('ar', 'personalStaff.linkRequired'))).toBeNull();
    expect(rememberBusiness).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });
});
