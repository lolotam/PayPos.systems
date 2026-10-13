import { useState, type ReactNode } from 'react';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { RecorderMembershipField } from '../ui/recorder-membership-field';
import { useRecordingContext } from './use-recording-context';
const state = vi.hoisted(() => ({ get: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const ids: [string, string] = ['01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000a2'];
const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const base = { generated_at: '2026-10-13T08:00:00.000Z', business_timezone: 'Asia/Kuwait', recorder_membership_ids: ids };
function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
function MembershipHarness({ place, onChange }: { place: typeof scope; onChange: (id: string | null) => void }) {
  const [value, setValue] = useState<string | null>(ids[0]);
  return <RecorderMembershipField scope={place} value={value} onChange={(id) => { setValue(id); onChange(id); }} />;
}
it.each(['companyId', 'businessId', 'branchId', 'userId'] as const)('clears a selected membership before fetching a changed %s', async (key) => {
  state.locale = 'en'; state.get.mockReset(); const onChange = vi.fn();
  state.get.mockResolvedValueOnce({ data: { ...base, recorder_membership_id: ids[0], discount_limit: { source: 'PERSON', bps: 1000 } } })
    .mockResolvedValue({ data: { ...base, recorder_membership_id: null, discount_limit: null } });
  const view = render(<MembershipHarness place={scope} onChange={onChange} />, { wrapper: setup().wrapper });
  await screen.findByText('10.00%'); view.rerender(<MembershipHarness place={{ ...scope, [key]: 'changed' }} onChange={onChange} />);
  await waitFor(() => expect(state.get).toHaveBeenCalledTimes(2)); expect(state.get.mock.lastCall?.[1].params.query).toEqual({});
  expect(onChange).toHaveBeenCalledWith(null); expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('');
});
it('recovers a revoked explicit membership through a fresh candidate read and the remaining membership', async () => {
  state.locale = 'en'; const { client, wrapper } = setup(), onChange = vi.fn(); let revoked = false;
  const old = { ...base, recorder_membership_id: ids[0], discount_limit: { source: 'PERSON', bps: 1000 } };
  state.get.mockReset(); state.get.mockImplementation((_, options) => Promise.resolve(revoked && options.params.query.recorder_membership_id === ids[0]
    ? { error: { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Refusal EN' }, response: { status: 403 } }
    : { data: revoked ? { ...base, recorder_membership_ids: [ids[1]], recorder_membership_id: ids[1], discount_limit: { source: 'PERSON', bps: 0 } } : old }));
  render(<MembershipHarness place={scope} onChange={onChange} />, { wrapper }); await screen.findByText('10.00%');
  client.setQueryData(['session-recording-context', 'company', 'business', 'branch', 'actor', null], old); revoked = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ['session-recording-context'] }); }); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.retryContext') })); await screen.findByText('0.00%');
  expect(onChange).toHaveBeenCalledWith(null); await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(ids[1]));
  expect(state.get.mock.calls.some((call) => !call[1].params.query.recorder_membership_id)).toBe(true);
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query).toEqual({ recorder_membership_id: ids[1] }));
});
it('sends scope, abort signal and an explicit membership in the parsed context request', async () => {
  state.get.mockReset(); state.get.mockResolvedValue({ data: { ...base, recorder_membership_id: ids[1], discount_limit: { source: 'PERSON', bps: 1000 } } });
  const hook = renderHook(() => useRecordingContext(scope, ids[1]), { wrapper: setup().wrapper });
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(state.get.mock.lastCall).toEqual(['/v1/businesses/{businessId}/branches/{branchId}/service-sessions/recording-context', {
    params: { header: { 'x-company-id': 'company' }, path: { businessId: 'business', branchId: 'branch' }, query: { recorder_membership_id: ids[1] } }, signal: expect.any(AbortSignal),
  }]);
});
it('presents only server candidates without picking a limit on ambiguity', async () => {
  state.locale = 'en'; state.get.mockResolvedValue({ data: { ...base, recorder_membership_id: null, discount_limit: null } });
  const onChange = vi.fn(), { wrapper } = setup();
  render(<RecorderMembershipField scope={scope} value={null} onChange={onChange} />, { wrapper });
  await screen.findByRole('option', { name: ids[1] }); expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByText(t('en', 'serviceSessions.limit'))).toBeNull();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: ids[0] } }); expect(onChange).toHaveBeenCalledWith(ids[0]);
  expect(screen.getAllByRole('option').map((option) => (option as HTMLOptionElement).value)).toEqual(['', ...ids]);
});
it.each(['ar', 'en'] as const)('shows sole/explicit selection and all server limit sources in %s', async (locale) => {
  state.locale = locale;
  const { client, wrapper } = setup(), onChange = vi.fn();
  state.get.mockResolvedValue({ data: { ...base, recorder_membership_ids: [ids[0]], recorder_membership_id: ids[0], discount_limit: { source: 'OWNER', bps: null } } });
  const view = render(<RecorderMembershipField scope={scope} value={null} onChange={onChange} />, { wrapper });
  await screen.findByText(t(locale, 'serviceSessions.unlimited')); expect(onChange).toHaveBeenCalledWith(ids[0]);
  for (const [source, bps, key] of [['NOT_CONFIGURED', 0, 'notConfigured'], ['PERSON', 0, 'limitPerson'], ['BUSINESS', 1000, 'limitBusiness']] as const) {
    state.get.mockResolvedValue({ data: { ...base, recorder_membership_id: ids[1], discount_limit: { source, bps } } });
    view.rerender(<RecorderMembershipField scope={scope} value={ids[1]} onChange={onChange} />);
    await act(async () => { await client.invalidateQueries({ queryKey: ['session-recording-context'] }); });
    await screen.findByText(t(locale, `serviceSessions.${key}`));
    expect(screen.getByText(bps === 0 ? '0.00%' : '10.00%')).toBeTruthy();
  }
});
it('retains refusal details without retry, permits explicit retry and disables fresh reads', async () => {
  state.locale = 'ar'; state.get.mockReset(); const error = { code: 'FORBIDDEN', message_ar: 'Refusal AR', message_en: 'Refusal EN' };
  state.get.mockResolvedValueOnce({ error, response: { status: 403 } }).mockResolvedValue({ data: { ...base, recorder_membership_id: null, discount_limit: null } });
  const { client, wrapper } = setup();
  const view = render(<RecorderMembershipField scope={scope} value={null} onChange={vi.fn()} />, { wrapper });
  expect((await screen.findByRole('alert')).textContent).toBe('Refusal AR'); expect(state.get).toHaveBeenCalledTimes(1);
  expect(client.getQueryState(['session-recording-context', 'company', 'business', 'branch', 'actor', null])?.error).toEqual({ ...error, status: 403 });
  fireEvent.click(screen.getByRole('button', { name: t('ar', 'serviceSessions.retryContext') })); await screen.findByRole('option', { name: ids[1] });
  view.unmount(); state.get.mockClear(); renderHook(() => useRecordingContext(scope, null, false), { wrapper: setup().wrapper }); expect(state.get).not.toHaveBeenCalled();
});
it('rejects malformed data and invalid membership text before HTTP', async () => {
  state.get.mockReset(); state.get.mockResolvedValue({ data: { ...base, recorder_membership_id: ids[0], discount_limit: { source: 'OWNER', bps: 0 } } });
  const hook = renderHook(() => useRecordingContext(scope, null), { wrapper: setup().wrapper }); await waitFor(() => expect(hook.result.current.isError).toBe(true));
  state.get.mockClear(); const invalid = renderHook(() => useRecordingContext(scope, 'foreign-text'), { wrapper: setup().wrapper });
  await waitFor(() => expect(invalid.result.current.isError).toBe(true)); expect(state.get).not.toHaveBeenCalled();
});
