import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DiscountLimitForm } from './discount-limit-form';

const state = vi.hoisted(() => ({ locale: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));

it.each(['en', 'ar'] as const)(
  'shows two decimals and submits exact bps and a trimmed reason in %s',
  async (locale) => {
    state.locale = locale;
    const save = vi.fn();
    render(<DiscountLimitForm limitBps={1234} disabled={false} pending={false} onSave={save} />);
    const input = screen.getByLabelText(t(locale, 'permissions.discountLimit')) as HTMLInputElement;
    expect(input.value).toBe('12.34');
    fireEvent.change(input, { target: { value: '5.01' } });
    fireEvent.change(screen.getByLabelText(t(locale, 'permissions.reason')), {
      target: { value: ' synthetic ' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'permissions.discountSave') }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ limit_bps: 501, reason: 'synthetic' }, expect.anything()),
    );
  },
);
it('clears an unset or zero value with a mandatory reason, independently of percentage validity', () => {
  state.locale = 'en';
  const save = vi.fn();
  render(<DiscountLimitForm limitBps={0} disabled={false} pending={false} onSave={save} />);
  expect(
    (screen.getByLabelText(t('en', 'permissions.discountLimit')) as HTMLInputElement).value,
  ).toBe('0.00');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'permissions.discountClear') }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t('en', 'permissions.discountLimit')), {
    target: { value: '' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'permissions.reason')), {
    target: { value: ' clear ' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'permissions.discountClear') }));
  expect(save).toHaveBeenCalledWith({ limit_bps: null, reason: 'clear' });
});
it.each(['100.01', '0.001', '-1', '1e1'])(
  'refuses %s without rounding or submitting',
  async (percentage) => {
    state.locale = 'en';
    const save = vi.fn();
    render(<DiscountLimitForm limitBps={null} disabled={false} pending={false} onSave={save} />);
    fireEvent.change(screen.getByLabelText(t('en', 'permissions.discountLimit')), {
      target: { value: percentage },
    });
    fireEvent.change(screen.getByLabelText(t('en', 'permissions.reason')), {
      target: { value: 'Synthetic' },
    });
    fireEvent.click(screen.getByRole('button', { name: t('en', 'permissions.discountSave') }));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(t('en', 'permissions.discountInvalid')),
    );
    expect(save).not.toHaveBeenCalled();
  },
);
it.each([
  { disabled: true, pending: false },
  { disabled: false, pending: true },
])('disables both commands when %j', (flags) => {
  state.locale = 'en';
  render(<DiscountLimitForm limitBps={null} {...flags} onSave={vi.fn()} />);
  expect(
    screen.getByRole('button', { name: t('en', 'permissions.discountSave') }).closest('fieldset')
      ?.disabled,
  ).toBe(true);
  expect(
    screen.getByRole('button', { name: t('en', 'permissions.discountClear') }).closest('fieldset')
      ?.disabled,
  ).toBe(true);
});
