import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ServiceForm } from './service-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

it.each(['ar', 'en'] as const)(
  'validates and submits the contract with bilingual labels in %s',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    render(<ServiceForm pending={false} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'catalogServices.create') }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(t(locale, 'catalogServices.nameEn')), {
      target: { value: '  Synthetic service  ' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'catalogServices.price')), {
      target: { value: '12.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'catalogServices.create') }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0]).toEqual({
      name_en: 'Synthetic service',
      name_ar: null,
      price: '12.500',
      commission_rule: { kind: 'FOLLOW_PLAN' },
      counts_toward_threshold: true,
    });
  },
);

it('disables submission during the pending request', () => {
  render(<ServiceForm pending={true} onSave={vi.fn()} />);
  expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true);
});
