import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';
import type * as NativeShellModule from '@/shared/platform/native-shell';

import { PasteLinkForm } from './paste-link-form';

const { HOST, COMPANY, BUSINESS } = vi.hoisted(() => ({
  HOST: 'pos.staging.pospay.systems',
  COMPANY: '00000000-0000-4000-8000-000000000001',
  BUSINESS: '00000000-0000-4000-8000-000000000002',
}));

const fakes = vi.hoisted(() => ({
  native: false,
  capabilities: { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true },
}));

vi.mock('@/shared/platform/native-shell', async (importOriginal) => ({
  ...(await importOriginal<typeof NativeShellModule>()),
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
  isNativeShell: vi.fn(() => fakes.native),
  capabilities: vi.fn(() => fakes.capabilities),
}));

// الكاميرا نفسها مش موضوع الاختبار: الاختبار بيضغط على «الكاميرا سلمت كود» أو «الكاميرا فشلت».
vi.mock('@/shared/qr/qr-camera', () => ({
  QrCamera: ({ scanned, failed }: { scanned(value: string): Promise<void>; failed(): void }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          void scanned(`https://${HOST}/personal?company=${COMPANY}&business=${BUSINESS}`)
        }
      >
        synthetic valid scan
      </button>
      <button type="button" onClick={() => void scanned('https://elsewhere.example/personal')}>
        synthetic foreign scan
      </button>
      <button type="button" onClick={failed}>
        synthetic camera failure
      </button>
    </div>
  ),
}));

function mount(locked = false) {
  const onConnect = vi.fn();
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <PasteLinkForm onConnect={onConnect} locked={locked} />
    </LocaleProvider>,
  );
  return onConnect;
}

function paste(value: string) {
  fireEvent.change(screen.getByLabelText(t('ar', 'nativeShell.pasteLabel')), {
    target: { value },
  });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.pasteSubmit') }));
}

describe('PasteLinkForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // الشاشة دي بتظهر جوه `NativeEntry` بس، فالحالة هنا نسخة التطبيق الأصلي.
    fakes.native = true;
    fakes.capabilities = { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true };
  });

  it('connects the business of a pasted manager link', () => {
    const onConnect = mount();

    paste(`https://elsewhere.example/personal?company=${COMPANY}&business=${BUSINESS}`);
    expect(screen.getByRole('alert').textContent).toBe(t('ar', 'personalStaff.linkRequired'));

    paste(`https://${HOST}/personal?company=${COMPANY}&business=${BUSINESS}`);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onConnect).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });

  it('asks for the manager link and keeps the field when the link is not accepted', () => {
    const onConnect = mount();
    const pasted = `https://elsewhere.example/personal?company=${COMPANY}&business=${BUSINESS}`;

    paste(pasted);

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(t('ar', 'personalStaff.linkRequired'));
    expect(onConnect).not.toHaveBeenCalled();
    expect(
      (screen.getByLabelText(t('ar', 'nativeShell.pasteLabel')) as HTMLInputElement).value,
    ).toBe(pasted);
  });

  it('asks for the whole link and never for an identifier', () => {
    mount();

    const field = screen.getByLabelText(t('ar', 'nativeShell.pasteLabel'));
    expect(field.getAttribute('type')).toBe('url');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('disables the submit button while locked', () => {
    mount(true);

    const submit = screen.getByRole('button', { name: t('ar', 'nativeShell.pasteSubmit') });
    expect(submit.hasAttribute('disabled')).toBe(true);
  });
});

describe('PasteLinkForm with the salon code camera (FR-014)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // الشاشة دي بتظهر جوه `NativeEntry` بس، فالحالة هنا نسخة التطبيق الأصلي.
    fakes.native = true;
    fakes.capabilities = { webPush: true, passkeys: true, qrScan: true, attendanceCamera: true };
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('connects the business of a scanned salon code', () => {
    const onConnect = mount();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.scanSalonQr') }));
    expect(screen.getByRole('button', { name: 'synthetic valid scan' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'synthetic valid scan' }));

    expect(onConnect).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
    expect(screen.queryByRole('button', { name: 'synthetic valid scan' })).toBeNull();
  });

  it('asks for the manager link when the scanned code is not a manager link', () => {
    const onConnect = mount();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.scanSalonQr') }));
    fireEvent.click(screen.getByRole('button', { name: 'synthetic foreign scan' }));

    expect(screen.getByRole('alert').textContent).toBe(t('ar', 'personalStaff.linkRequired'));
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'synthetic foreign scan' })).toBeNull();
  });

  it('hides the scan button and offers the web app when the build has no camera', () => {
    fakes.capabilities = { webPush: true, passkeys: true, qrScan: false, attendanceCamera: false };
    vi.stubEnv('VITE_NATIVE', '1');
    vi.stubEnv('VITE_POS_HOST', HOST);

    mount();

    expect(screen.queryByRole('button', { name: t('ar', 'nativeShell.scanSalonQr') })).toBeNull();
    expect(screen.getByText(t('ar', 'nativeShell.webOnlyNotice'))).toBeDefined();
    const link = screen.getByRole('link', { name: t('ar', 'nativeShell.openWebApp') });
    expect(link.getAttribute('href')).toBe(`https://${HOST}/personal`);
  });

  it('keeps the paste form working when the camera is refused', () => {
    const onConnect = mount();

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'nativeShell.scanSalonQr') }));
    fireEvent.click(screen.getByRole('button', { name: 'synthetic camera failure' }));

    expect(screen.getByRole('alert').textContent).toBe(t('ar', 'nativeShell.scanCameraDenied'));
    expect(screen.queryByRole('button', { name: 'synthetic camera failure' })).toBeNull();

    paste(`https://${HOST}/personal?company=${COMPANY}&business=${BUSINESS}`);
    expect(onConnect).toHaveBeenCalledWith({
      company_id: COMPANY,
      business_id: BUSINESS,
    });
  });

  it('shows the scan button with the camera off for the attendance part only', () => {
    fakes.capabilities = { webPush: true, passkeys: true, qrScan: true, attendanceCamera: false };

    mount();

    expect(screen.getByRole('button', { name: t('ar', 'nativeShell.scanSalonQr') })).toBeDefined();
  });
});
