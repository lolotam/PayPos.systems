import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SalaryForm } from './salary-form';
const state = vi.hoisted(() => ({ locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
it.each(['ar', 'en'] as const)(
  'validates and submits zero salary with trimmed reason in %s',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    render(<SalaryForm pending={false} onSave={save} />);
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'salary.set') }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(t(locale, 'salary.date')), {
      target: { value: '2026-01-01' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'salary.amount')), {
      target: { value: '0.000' },
    });
    fireEvent.change(screen.getByLabelText(t(locale, 'salary.reason')), {
      target: { value: ' Synthetic reason ' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'salary.set') }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        { effective_from: '2026-01-01', amount: '0.000', reason: 'Synthetic reason' },
        expect.anything(),
      ),
    );
  },
);
