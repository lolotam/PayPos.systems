import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionServiceField } from './session-service-field';
const state = vi.hoisted(() => ({ get: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const option = { id: '01920000-0000-7000-8000-0000000000a2', name_ar: null, name_en: 'Z synthetic', price: '7.125', revision: 1 };
it.each(['ar', 'en'] as const)('preserves server order across pages and retains the selected name during search in %s', async (locale) => {
  state.locale = locale;
  const next = { ...option, id: '01920000-0000-7000-8000-0000000000a3', name_en: 'A synthetic' };
  state.get.mockResolvedValueOnce({ data: { items: [option], next_cursor: 'next' } })
    .mockResolvedValueOnce({ data: { items: [next], next_cursor: null } }).mockResolvedValue({ data: { items: [], next_cursor: null } });
  const change = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><SessionServiceField scope={{ companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' }} value={option} onChange={change} /></QueryClientProvider>);
  await screen.findByRole('button', { name: t(locale, 'serviceSessions.moreServices') });
  fireEvent.click(screen.getByRole('button'));
  await screen.findByRole('option', { name: next.name_en });
  expect(screen.getAllByRole('option').slice(1).map((node) => node.textContent)).toEqual([option.name_en, next.name_en]);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: next.id } }); expect(change).toHaveBeenCalledWith(next);
  fireEvent.change(screen.getByLabelText(t(locale, 'serviceSessions.searchServices')), { target: { value: 'absent' } });
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe(t(locale, 'serviceSessions.noServices')));
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(option.id);
  expect(change).toHaveBeenCalledTimes(1);
});
it('localizes a refusal and permits an explicit read retry', async () => {
  state.locale = 'ar'; state.get.mockReset();
  state.get.mockResolvedValueOnce({ error: { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Refusal EN' }, response: { status: 403 } })
    .mockResolvedValueOnce({ data: { items: [option], next_cursor: null } });
  render(<QueryClientProvider client={new QueryClient()}><SessionServiceField scope={{ companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' }} value={null} onChange={vi.fn()} /></QueryClientProvider>);
  expect((await screen.findByRole('alert')).textContent).toBe('Refusal AR');
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'serviceSessions.retryServices') }));
  await screen.findByRole('option', { name: option.name_en }); expect(state.get).toHaveBeenCalledTimes(2);
});
