import { t } from '@pospay/i18n';
import { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import { createSessionDraft, type SessionDraftForm } from '../model/session-drafts';
import { SessionDraftLines } from './session-draft-lines';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const service = { id: '01920000-0000-7000-8000-0000000000a2', name_ar: null, name_en: 'Synthetic service', price: '7.125', revision: 1 };
let current: SessionDraftForm['lines'];
function Harness({ disabled = false }: { disabled?: boolean }) {
  const form = useForm<SessionDraftForm>({ defaultValues: { lines: [createSessionDraft('initial')] }, mode: 'onBlur' });
  const watched = useWatch({ control: form.control, name: 'lines' });
  useEffect(() => { current = watched; }, [watched]);
  return <FormProvider {...form}><form><SessionDraftLines scope={{ companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' }} disabled={disabled} /></form></FormProvider>;
}
function mount(disabled = false) {
  servicePage([service]); const client = new QueryClient();
  render(<QueryClientProvider client={client}><Harness disabled={disabled} /></QueryClientProvider>); return client;
}
function servicePage(items: typeof service[]) {
  get.mockImplementation((path) => Promise.resolve({ data: path.endsWith('/recording-context')
    ? { generated_at: '2026-10-13T08:00:00.000Z', business_timezone: 'Asia/Kuwait', recorder_membership_ids: [service.id], recorder_membership_id: service.id, discount_limit: { source: 'PERSON', bps: 1000 } }
    : { items: path.endsWith('/performer-options') ? [] : items, next_cursor: null } }));
}
const button = (key: 'addLine' | 'removeLine') => screen.getAllByRole('button', { name: t('en', `serviceSessions.${key}`) });
function at<T>(items: T[], index: number): T { const value = items[index]; if (value === undefined) throw new Error('Missing fixture row'); return value; }
async function choose(index = 0) {
  await waitFor(() => expect(screen.getAllByLabelText(t('en', 'serviceSessions.service'))[index]?.querySelector(`option[value="${service.id}"]`)).toBeTruthy());
  fireEvent.change(at(screen.getAllByLabelText(t('en', 'serviceSessions.service')), index), { target: { value: service.id } });
}
it('allows duplicate services and keeps row identity, picker state and prices after removal', async () => {
  mount(); await choose(); fireEvent.click(at(button('addLine'), 0)); await choose(1);
  for (const n of [1, 2]) expect(within(screen.getByRole('group', { name: t('en', 'serviceSessions.lineNumber').replace('{n}', String(n)) })).getByLabelText(t('en', 'serviceSessions.price'))).toBeTruthy();
  const survivor = at(current, 1).local_id;
  fireEvent.change(at(screen.getAllByLabelText(t('en', 'serviceSessions.price')), 1), { target: { value: '20.5' } });
  fireEvent.blur(at(screen.getAllByLabelText(t('en', 'serviceSessions.price')), 1));
  expect(current.map((row) => row.service_id)).toEqual([service.id, service.id]);
  fireEvent.click(at(button('removeLine'), 0));
  expect(current).toMatchObject([{ local_id: survivor, service_id: service.id, price: '20.500' }]);
  expect(screen.getByLabelText(t('en', 'serviceSessions.price')).id).toBe(`${survivor}-price`);
  expect((screen.getByLabelText(t('en', 'serviceSessions.service')) as HTMLSelectElement).value).toBe(service.id);
  expect((button('removeLine')[0] as HTMLButtonElement).disabled).toBe(true);
});
it.each([['0', '0.000'], ['99999999999.999', '99999999999.999'], ['25.5', '25.500']])('keeps %s as a string override through catalog refresh', async (text, expected) => {
  const client = mount(); await choose(); const input = screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement;
  fireEvent.change(input, { target: { value: text } }); expect(input.value).toBe(text); fireEvent.blur(input);
  expect(current[0]?.price).toBe(expected);
  servicePage([{ ...service, price: '50.000', revision: 2 }]);
  await act(async () => { await client.invalidateQueries({ queryKey: ['session-services'] }); });
  expect(await screen.findByText('50.000')).toBeTruthy(); expect(current[0]?.price).toBe(expected);
  await waitFor(() => expect(current[0]?.service?.price).toBe('50.000'));
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.service')), { target: { value: service.id } });
  expect(current[0]?.price).toBe(expected); expect(input.value).toBe(expected);
  servicePage([]);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.searchServices')), { target: { value: 'absent' } });
  await screen.findByText(t('en', 'serviceSessions.noServices'));
  expect(screen.getByText('50.000')).toBeTruthy(); expect(current[0]?.price).toBe(expected);
});
it('caps draft rows at twenty and leaves invalid monetary text for validation', async () => {
  mount(); const add = at(button('addLine'), 0); for (let count = 1; count < 20; count++) fireEvent.click(add);
  expect(current).toHaveLength(20); expect(new Set(current.map((row) => row.local_id)).size).toBe(20);
  expect((button('addLine')[0] as HTMLButtonElement).disabled).toBe(true);
  const input = at(screen.getAllByLabelText(t('en', 'serviceSessions.price')), 0);
  fireEvent.change(input, { target: { value: '1.2345' } }); fireEvent.blur(input);
  await screen.findByRole('alert'); expect(current[0]?.price).toBe('1.2345');
});
it('supports a disabled editor without fresh reads', () => {
  get.mockClear(); mount(true); expect(get).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.addLine') }).closest('fieldset')?.disabled).toBe(true);
});
it('shows the resolved limit in the draft summary and validates discount again when price changes', async () => {
  mount(); await choose(); await waitFor(() => expect(screen.getAllByText('10.00%')).toHaveLength(2));
  const price = screen.getByLabelText(t('en', 'serviceSessions.price')), discount = screen.getByLabelText(t('en', 'serviceSessions.discountAmount'));
  fireEvent.change(discount, { target: { value: '5.000' } }); fireEvent.blur(discount);
  fireEvent.change(price, { target: { value: '4.000' } }); await screen.findByRole('alert'); expect(discount.getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(price, { target: { value: '6.000' } }); await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  fireEvent.change(price, { target: { value: 'unfinished' } }); fireEvent.blur(price);
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe(t('en', 'serviceSessions.invalidPrice')));
  expect(discount.getAttribute('aria-invalid')).toBe('false');
});
