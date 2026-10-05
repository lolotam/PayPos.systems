import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { t, type Locale } from '@pospay/i18n';
import { LocaleProvider } from '@/shared/locale/locale-context';
import { personalCalls } from '../api/personal-calls';
import { EnrolPasskeyScreen } from './enrol-passkey-screen';
vi.mock('../api/personal-calls', () => ({ personalCalls: { binding: vi.fn(), enrol: vi.fn() } }));
function mount(locale: Locale) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={cache}>
      <LocaleProvider locale={locale} setLocale={() => undefined}>
        <EnrolPasskeyScreen employeeId="synthetic" onSignOut={async () => undefined} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.clearAllMocks());
it.each(['ar', 'en'] as const)(
  'an existing binding refuses replacement in %s UI',
  async (locale) => {
    vi.mocked(personalCalls.binding).mockResolvedValue({
      bound: true,
      binding_id: 'synthetic',
      revision: 1,
      bound_at: '2026-10-04T00:00:00Z',
    });
    const view = mount(locale);
    await screen.findByText(t(locale, 'personalStaff.bound'));
    expect(screen.queryByRole('button', { name: t(locale, 'personalStaff.enrol') })).toBeNull();
    expect(personalCalls.enrol).not.toHaveBeenCalled();
    view.unmount();
  },
);
it('cancelling WebAuthn shows a translated error and keeps first enrollment available', async () => {
  vi.mocked(personalCalls.binding).mockResolvedValue({
    bound: false,
    binding_id: null,
    revision: null,
    bound_at: null,
  });
  vi.mocked(personalCalls.enrol).mockRejectedValue(new Error('SYNTHETIC_CANCEL'));
  const view = mount('ar');
  const button = await screen.findByRole('button', { name: t('ar', 'personalStaff.enrol') });
  fireEvent.click(button);
  await screen.findByRole('alert');
  expect(screen.getByRole('alert').textContent).toBe(t('ar', 'errors.PASSKEY_INVALID'));
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  view.unmount();
});
