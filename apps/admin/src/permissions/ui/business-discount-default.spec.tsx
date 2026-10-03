import { t } from '@pospay/i18n';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { BusinessDiscountDefault } from './business-discount-default';

const state = vi.hoisted(() => ({
  locale: 'en' as 'ar' | 'en',
  limit: null as number | null,
  error: false,
  success: false,
  pending: false,
  mutate: vi.fn(),
  hook: vi.fn(),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
vi.mock('../api/use-business-discount-default', () => ({
  useBusinessDiscountDefault: (...args: string[]) => {
    state.hook(...args);
    return {
      query: { data: { limit_bps: state.limit }, isPending: false, isError: false },
      mutation: {
        mutate: state.mutate,
        isPending: state.pending,
        isError: state.error,
        isSuccess: state.success,
        error: {
          message_ar: t('ar', 'errors.FORBIDDEN'),
          message_en: 'Synthetic refusal',
        },
      },
    };
  },
}));
const props = {
  companyId: 'company',
  userId: 'user',
  businessId: 'business',
  businessName: 'Synthetic salon',
};

it.each(['ar', 'en'] as const)(
  'BD-10 selected business, exact save and clear in %s',
  async (locale) => {
    Object.assign(state, { locale, limit: 1234, error: false, success: false, pending: false });
    state.mutate.mockClear();
    render(<BusinessDiscountDefault {...props} />);
    expect(state.hook).toHaveBeenCalledWith('company', 'user', 'business');
    expect(screen.getByRole('heading').textContent).toContain(props.businessName);
    const input = screen.getByLabelText(
      t(locale, 'permissions.businessDiscountLabel'),
    ) as HTMLInputElement;
    expect(input.value).toBe('12.34');
    fireEvent.change(input, { target: { value: '5.00' } });
    fireEvent.change(screen.getByLabelText(t(locale, 'permissions.reason')), {
      target: { value: ' synthetic ' },
    });
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'permissions.discountSave') }));
    await waitFor(() =>
      expect(state.mutate).toHaveBeenCalledWith({ limit_bps: 500, reason: 'synthetic' }),
    );
    fireEvent.click(screen.getByRole('button', { name: t(locale, 'permissions.discountClear') }));
    expect(state.mutate).toHaveBeenCalledWith({ limit_bps: null, reason: 'synthetic' });
  },
);
it('refuses invalid input and a clear without reason, preserving NOT_CONFIGURED text', async () => {
  Object.assign(state, { locale: 'en', limit: null, error: false, success: false, pending: false });
  state.mutate.mockClear();
  render(<BusinessDiscountDefault {...props} />);
  expect(
    screen.getByText(t('en', 'permissions.businessDiscountUnset'), { exact: false }),
  ).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'permissions.discountClear') }));
  expect(state.mutate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t('en', 'permissions.businessDiscountLabel')), {
    target: { value: '100.01' },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'permissions.reason')), {
    target: { value: 'Synthetic' },
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'permissions.discountSave') }));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(t('en', 'permissions.discountInvalid')),
  );
  expect(state.mutate).not.toHaveBeenCalled();
});
it.each(['ar', 'en'] as const)('shows server refusal and success in %s', (locale) => {
  Object.assign(state, { locale, limit: 0, error: true, success: true, pending: true });
  render(<BusinessDiscountDefault {...props} />);
  expect(screen.getByRole('alert').textContent).toBe(
    locale === 'ar' ? t('ar', 'errors.FORBIDDEN') : 'Synthetic refusal',
  );
  expect(screen.getByRole('status').textContent).toBe(t(locale, 'permissions.discountSaved'));
  expect(
    screen.getByRole('button', { name: t(locale, 'permissions.discountSave') }).closest('fieldset')
      ?.disabled,
  ).toBe(true);
});
