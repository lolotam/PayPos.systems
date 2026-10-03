import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RegisterDeviceInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { DirectionProvider } from '@pospay/ui';
import { describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/shared/locale/locale-context';

import { PairingForm } from './pairing-form';

function renderForm(
  onSubmit: (values: RegisterDeviceInput) => Promise<string | null>,
  locale: Locale = 'ar',
) {
  return render(
    <DirectionProvider dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <PairingForm onSubmit={onSubmit} />
      </LocaleProvider>
    </DirectionProvider>,
  );
}

it('renders pairing labels and controls with explicit counter-sized utilities', () => {
  const { container } = renderForm(vi.fn());
  for (const label of container.querySelectorAll('label')) {
    expect(label.classList.contains('text-base')).toBe(true);
    expect(label.classList.contains('text-sm')).toBe(false);
  }
  for (const input of container.querySelectorAll('input')) {
    expect(input.classList.contains('min-h-12')).toBe(true);
    expect(input.classList.contains('text-base')).toBe(true);
  }
  expect(screen.getByRole('button').classList.contains('text-lg')).toBe(true);
  expect(screen.getByRole('button').classList.contains('min-h-12')).toBe(true);
});

describe('PairingForm', () => {
  it('shows validation messages and does not submit when code or label are empty or malformed', async () => {
    const onSubmit = vi.fn();
    renderForm(onSubmit);

    fireEvent.click(screen.getByRole('button', { name: t('ar', 'pos.pairSubmit') }));

    await waitFor(() => {
      expect(screen.getByText(t('ar', 'pos.pairingCodeInvalid'))).not.toBeNull();
      expect(screen.getByText(t('ar', 'pos.labelInvalid'))).not.toBeNull();
    });
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(t('ar', 'pos.pairingCodeLabel')), {
      target: { value: 'TOO_SHORT' },
    });
    fireEvent.change(screen.getByLabelText(t('ar', 'pos.deviceLabel')), {
      target: { value: 'Valid Label' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'pos.pairSubmit') }));

    await waitFor(() => {
      expect(screen.getByText(t('ar', 'pos.pairingCodeInvalid'))).not.toBeNull();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('accepts lower-case code with surrounding spaces and submits trimmed and upper-cased', async () => {
    const onSubmit = vi.fn().mockResolvedValue(null);
    renderForm(onSubmit);

    fireEvent.change(screen.getByLabelText(t('ar', 'pos.pairingCodeLabel')), {
      target: { value: '  ab12cd34  ' },
    });
    fireEvent.change(screen.getByLabelText(t('ar', 'pos.deviceLabel')), {
      target: { value: '  Cashier 1  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'pos.pairSubmit') }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledOnce();
    });
    expect(onSubmit).toHaveBeenCalledWith({
      pairing_code: 'AB12CD34',
      label: 'Cashier 1',
    });
  });

  it('displays a returned error message in an alert element', async () => {
    const errorMessage = t('ar', 'errors.PAIRING_CODE_INVALID');
    const onSubmit = vi.fn().mockResolvedValue(errorMessage);
    renderForm(onSubmit);

    fireEvent.change(screen.getByLabelText(t('ar', 'pos.pairingCodeLabel')), {
      target: { value: 'ABCD1234' },
    });
    fireEvent.change(screen.getByLabelText(t('ar', 'pos.deviceLabel')), {
      target: { value: 'Cashier 1' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('ar', 'pos.pairSubmit') }));

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(errorMessage);
    });
  });
});
