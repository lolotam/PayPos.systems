import { render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readDeviceRole } from '@/app/device-role';
import { LocaleProvider } from '@/shared/locale/locale-context';

import { NativeEntry } from './native-entry';

vi.mock('@/app/device-role', () => ({
  readDeviceRole: vi.fn(),
  saveDeviceRole: vi.fn(),
}));
vi.mock('@/personal-staff/api/use-personal-session', () => ({
  usePersonalSession: () => ({
    epoch: 0,
    online: true,
    loading: false,
    session: null,
    changed: vi.fn(),
    signOut: vi.fn(),
  }),
}));

describe('NativeEntry employee flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readDeviceRole).mockResolvedValue('employee');
    window.history.replaceState({}, '', '/');
  });

  it('asks the manager for the link and shows no identifier field', async () => {
    render(
      <DirectionProvider dir="rtl">
        <LocaleProvider locale="ar" setLocale={() => undefined}>
          <NativeEntry />
        </LocaleProvider>
      </DirectionProvider>,
    );

    expect(await screen.findByText(t('ar', 'personalStaff.linkRequired'))).not.toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
