import { fireEvent, render, screen } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { PasteLinkForm } from './paste-link-form';

vi.mock('@/shared/platform/native-shell', () => ({
  nativePosHost: vi.fn(() => 'pos.staging.pospay.systems'),
}));

const HOST = 'pos.staging.pospay.systems';
const COMPANY = '00000000-0000-4000-8000-000000000001';
const BUSINESS = '00000000-0000-4000-8000-000000000002';

function mount() {
  const onConnect = vi.fn();
  render(
    <LocaleProvider locale="ar" setLocale={() => undefined}>
      <PasteLinkForm onConnect={onConnect} />
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
  });

  it('connects the business of a pasted manager link', () => {
    const onConnect = mount();

    paste(`https://${HOST}/personal?company=${COMPANY}&business=${BUSINESS}`);

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
});
