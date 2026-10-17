import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionServiceField } from './session-service-field';
import { emptySessionRecordingResult, transitionSessionRecordingResult as transition } from '../model/session-recording-result';
import { recordAttempt, response } from '../model/session-recording-result.fixture';
const state = vi.hoisted(() => ({ get: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const option = { id: '01920000-0000-7000-8000-0000000000a2', name_ar: null, name_en: 'Z synthetic', price: '7.125', revision: 1 };
const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
function mountField(onChange = vi.fn()) {
  render(<QueryClientProvider client={new QueryClient()}><SessionServiceField scope={scope} value={null} onChange={onChange} /></QueryClientProvider>);
}
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
it('prevents Enter in search from submitting the containing recording form', () => {
  state.locale = 'en'; state.get.mockResolvedValue({ data: { items: [], next_cursor: null } }); const submit = vi.fn();
  render(<QueryClientProvider client={new QueryClient()}><form onSubmit={(event) => { event.preventDefault(); submit(); }}
    onKeyDown={(event) => { if (event.key === 'Enter' && !event.defaultPrevented) event.currentTarget.requestSubmit(); }}>
    <SessionServiceField scope={scope} value={null} onChange={vi.fn()} /><button type="submit">Submit fixture</button>
  </form></QueryClientProvider>);
  expect(fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })).toBe(false); expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' })); expect(submit).toHaveBeenCalledTimes(1);
});
it('sends only the settled rapid-typing query after 300 ms and starts paging without the old cursor', async () => {
  state.locale = 'en'; state.get.mockReset();
  state.get.mockResolvedValueOnce({ data: { items: [option], next_cursor: 'next' } })
    .mockResolvedValue({ data: { items: [], next_cursor: null } }); mountField();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'serviceSessions.moreServices') }));
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2));
  vi.useFakeTimers();
  try {
    for (const value of ['s', 'se', 'settled']) { fireEvent.change(screen.getByRole('searchbox'), { target: { value } }); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
    expect(state.get).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(199); }); expect(state.get).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(state.get).toHaveBeenCalledTimes(3);
    expect(state.get.mock.lastCall?.[1].params.query).toEqual({ lang: 'en', q: 'settled', limit: 20 });
  } finally { vi.useRealTimers(); }
});
it('keeps loaded options usable after a failed next page or invalid search', async () => {
  state.locale = 'en'; state.get.mockReset(); const change = vi.fn();
  state.get.mockResolvedValueOnce({ data: { items: [option], next_cursor: 'next' } })
    .mockResolvedValueOnce({ error: { code: 'UNAVAILABLE', message_ar: 'Failure AR', message_en: 'Failure EN' }, response: { status: 503 } }); mountField(change);
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'serviceSessions.moreServices') })); await screen.findByRole('alert');
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'bad\u0000search' } });
  expect(screen.getByText(t('en', 'serviceSessions.invalidSearch'))).toBeTruthy();
  expect((screen.getByRole('combobox') as HTMLSelectElement).disabled).toBe(false);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: option.id } }); expect(change).toHaveBeenCalledWith(option); expect(state.get).toHaveBeenCalledTimes(2);
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
it.each(['ar', 'en'] as const)('shows a recovered rejected selection outside the first options page in %s', async (locale) => {
  state.locale = locale; state.get.mockReset(); state.get.mockResolvedValue({ data: { items: [option], next_cursor: 'next' } });
  const pending = transition(emptySessionRecordingResult(), { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: recordAttempt } });
  const restored = pending.drafts.lines[1]; if (!restored?.service) throw new Error('Missing restored selection');
  const client = new QueryClient(), onChange = vi.fn(), view = render(<QueryClientProvider client={client}>
    <SessionServiceField scope={scope} value={restored.service} onChange={onChange} /></QueryClientProvider>);
  await screen.findByRole('option', { name: option.name_en });
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(select.value).toBe(restored.service_id); expect(select.selectedOptions[0]?.textContent).toBe(restored.service_id);
  expect(screen.queryByText(t(locale, 'serviceSessions.listPrice'))).toBeNull();
  const partial = transition(pending, { type: 'RECORDED', attempt: recordAttempt, response }), rejected = partial.drafts.lines[0];
  if (!rejected?.service) throw new Error('Missing rejected selection');
  view.rerender(<QueryClientProvider client={client}><SessionServiceField scope={scope} value={rejected.service} onChange={onChange} /></QueryClientProvider>);
  expect(select.value).toBe(rejected.service_id); expect(select.selectedOptions[0]?.textContent).toBe(response.rejected_lines[0]?.name_en);
  expect(screen.getByText(t(locale, 'serviceSessions.listPrice')).textContent).toContain('7.125'); expect(onChange).not.toHaveBeenCalled();
});
it.each(['ar', 'en'] as const)('labels a recovered service while the options load and keeps its service_id in %s', async (locale) => {
  state.locale = locale; state.get.mockReset(); state.get.mockReturnValue(new Promise(() => {}));
  const pending = transition(emptySessionRecordingResult(), { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: recordAttempt } });
  const draft = pending.drafts.lines[0]; if (!draft?.service) throw new Error('Missing recovered service');
  render(<QueryClientProvider client={new QueryClient()}><SessionServiceField scope={scope} value={draft.service} onChange={vi.fn()} /></QueryClientProvider>);
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(select.selectedOptions[0]?.textContent).toBe(t(locale, 'serviceSessions.loadingService'));
  expect(select.value).toBe(draft.service_id); expect(screen.queryByText(draft.service_id)).toBeNull();
});
it.each(['ar', 'en'] as const)('makes no loading claim for a recovered service when the options do not load in %s', async (locale) => {
  state.locale = locale; state.get.mockReset();
  const pending = transition(emptySessionRecordingResult(), { type: 'JOURNAL', entry: { version: 1, state: 'PENDING', attempt: recordAttempt } });
  const draft = pending.drafts.lines[0]; if (!draft?.service) throw new Error('Missing recovered service');
  render(<QueryClientProvider client={new QueryClient()}><SessionServiceField scope={scope} value={draft.service} onChange={vi.fn()} disabled /></QueryClientProvider>);
  const select = screen.getByRole('combobox') as HTMLSelectElement;
  expect(state.get).not.toHaveBeenCalled();
  expect(select.value).toBe(draft.service_id);
  expect(select.selectedOptions[0]?.textContent).not.toBe(t(locale, 'serviceSessions.loadingService'));
});
