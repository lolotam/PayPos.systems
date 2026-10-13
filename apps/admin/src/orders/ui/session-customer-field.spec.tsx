import { useEffect } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import { SessionCustomerField, type SessionCustomerSelection } from './session-customer-field';

const state = vi.hoisted(() => ({ post: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ POST: state.post }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const id = '01920000-0000-7000-8000-0000000000a2';
const saved = { id, name: 'Canonical synthetic customer', locale: 'ar', opted_out: false, phone: '***001' };
let selection: SessionCustomerSelection | null;
function Harness({ disabled = false }: { disabled?: boolean }) {
  const form = useForm<{ customer: SessionCustomerSelection | null }>({ defaultValues: { customer: null } });
  const watched = useWatch({ control: form.control, name: 'customer' });
  useEffect(() => { selection = watched; }, [watched]);
  return <form><Controller control={form.control} name="customer" render={({ field }) =>
    <SessionCustomerField companyId="company" branchId="branch" userId="actor" value={field.value}
      onChange={field.onChange} onBlur={field.onBlur} disabled={disabled} />
  } /></form>;
}
function mount(disabled = false) {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><Harness disabled={disabled} /></QueryClientProvider>);
  return client;
}
function fill() {
  for (const [key, value] of [['name', 'Entered synthetic name'], ['callingCode', '999'], ['phone', '00000001']] as const) {
    fireEvent.change(screen.getByLabelText(t(state.locale, `serviceSessions.${key}`)), { target: { value } });
  }
}
function resolve() { fireEvent.click(screen.getByRole('button', { name: t(state.locale, 'serviceSessions.findOrCreate') })); }

it.each(['ar', 'en'] as const)('selects a returned customer, including opt-out, and clears raw phone in %s', async (locale) => {
  state.locale = locale;
  const record = { ...saved, name: locale === 'en' ? 'Entered synthetic name' : saved.name, opted_out: locale === 'ar' };
  state.post.mockResolvedValueOnce({ data: record });
  const client = mount();
  fill(); resolve();
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(selection).toEqual({ id, name: record.name, phone: record.phone });
  expect(screen.getByRole('status').textContent).toContain(saved.phone);
  expect((screen.getByLabelText(t(locale, 'serviceSessions.phone')) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(t(locale, 'serviceSessions.callingCode')) as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText(t(locale, 'serviceSessions.name')) as HTMLInputElement).value).toBe(record.name);
  expect(state.post.mock.lastCall?.[1].body.locale).toBe(locale);
  await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0));
});

it.each(['name', 'callingCode', 'phone'] as const)('invalidates the RHF selection when %s changes', async (key) => {
  state.post.mockResolvedValueOnce({ data: saved }); mount(); fill(); resolve();
  await screen.findByRole('status');
  fireEvent.change(screen.getByLabelText(t(state.locale, `serviceSessions.${key}`)), { target: { value: '2' } });
  expect(selection).toBeNull(); expect(screen.queryByRole('status')).toBeNull();
});

it('requires valid entry and preserves it on a localized HTTP refusal', async () => {
  state.post.mockClear(); state.locale = 'ar'; mount(); resolve();
  await screen.findByRole('alert'); expect(state.post).not.toHaveBeenCalled();
  state.post.mockResolvedValueOnce({ error: { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Refusal EN' }, response: { status: 403 } });
  fill(); resolve();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Refusal AR'));
  expect(selection).toBeNull(); expect(state.post).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText(t('ar', 'serviceSessions.phone')) as HTMLInputElement).value).toBe('00000001');
});

it('disables entry while pending and does not select on a network failure', async () => {
  let reject!: (reason: Error) => void;
  state.post.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  mount(); fill(); resolve();
  await waitFor(() => expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true));
  await act(async () => reject(new Error('Synthetic network loss')));
  await screen.findByRole('alert'); expect(selection).toBeNull();
});

it('supports the caller disabling find-or-create while offline', () => {
  mount(true); expect(screen.getByRole('button').closest('fieldset')?.disabled).toBe(true);
});


