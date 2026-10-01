import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { t } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { TotpForm } from './totp-form';

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <DirectionProvider dir="rtl">
      <LocaleProvider locale="ar" setLocale={() => undefined}>
        {ui}
      </LocaleProvider>
    </DirectionProvider>,
  );
}

describe('TotpForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty input, non-digits, or codes other than 6 digits without calling onSubmit', async () => {
    const onSubmit = vi.fn();
    renderWithProviders(<TotpForm pending={false} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'admin.verifySubmit') }));

    await waitFor(() => {
      expect(screen.getByText(t('ar', 'admin.codeInvalid'))).not.toBeNull();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    const codeInput = screen.getByLabelText(t('ar', 'admin.codeLabel'));

    fireEvent.change(codeInput, { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'admin.verifySubmit') }));

    await waitFor(() => {
      expect(screen.getByText(t('ar', 'admin.codeInvalid'))).not.toBeNull();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(codeInput, { target: { value: 'abcdef' } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'admin.verifySubmit') }));

    await waitFor(() => {
      expect(screen.getByText(t('ar', 'admin.codeInvalid'))).not.toBeNull();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('calls onSubmit once when exactly 6 digits are submitted', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(<TotpForm pending={false} onSubmit={onSubmit} />);

    const codeInput = screen.getByLabelText(t('ar', 'admin.codeLabel'));
    fireEvent.change(codeInput, { target: { value: '654321' } });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'admin.verifySubmit') }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ code: '654321' });
  });
});
