import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { expect, it, vi } from 'vitest';
import { createSessionDraft, sessionPerformerInputs, type SessionDraftForm } from '../model/session-drafts';
import { SessionPerformersField } from './session-performers-field';
const state = vi.hoisted(() => ({ get: vi.fn(), locale: 'en' as 'ar' | 'en' }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => state.locale }));
const scope = { companyId: 'company', businessId: 'business', branchId: 'branch', userId: 'actor' };
const instant = '2026-10-13T08:00:00.000Z';
const items = [1, 2, 3, 4].map((n) => ({ id: `01920000-0000-7000-8000-0000000000a${n}`, name_ar: String.fromCharCode(0x645, 0x648, 0x638, 0x641, 0x629) + ' ' + n, name_en: `Synthetic ${n}`,
  employee_number: null, not_clocked_in_warning: n === 1, approved_leave_warning: n === 2 }));
let form: ReturnType<typeof useForm<SessionDraftForm>>;
function Harness({ at, place = scope, disabled = false, submit = vi.fn() }: { at?: string; place?: typeof scope; disabled?: boolean; submit?: (data: unknown) => void }) {
  const methods = useForm<SessionDraftForm>({ defaultValues: { lines: [createSessionDraft('line')] } });
  useEffect(() => { form = methods; }, [methods]);
  return <FormProvider {...methods}><form onSubmit={methods.handleSubmit((data) => submit(sessionPerformerInputs(fixtureAt(data.lines, 0))))}
    onKeyDown={(event) => { if (event.key === 'Enter' && !event.defaultPrevented) event.currentTarget.requestSubmit(); }}>
    <SessionPerformersField scope={place} index={0} occurredAt={at} disabled={disabled} /><button type="submit">Submit fixture</button>
  </form></FormProvider>;
}
function mount(submit = vi.fn(), disabled = false) {
  state.get.mockReset(); state.get.mockImplementation((path, options) => Promise.resolve({ data: path.endsWith('/recording-context')
    ? { generated_at: instant, business_timezone: 'Asia/Kuwait', recorder_membership_ids: ['01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000a2'], recorder_membership_id: null, discount_limit: null }
    : { items: options.params.query.q ? items.slice(1) : items, next_cursor: null } }));
  const client = new QueryClient(), view = render(<QueryClientProvider client={client}><Harness submit={submit} disabled={disabled} /></QueryClientProvider>);
  return { ...view, client, submit };
}
const text = (key: 'performerNumber' | 'share' | 'removePerformer', n: number) => t(state.locale, `serviceSessions.${key}`).replace('{n}', String(n));
function fixtureAt<T>(values: T[], index: number): T { const value = values[index]; if (value === undefined) throw new Error('Missing fixture'); return value; }
function choose(n: number, item = n) { fireEvent.change(screen.getByLabelText(text('performerNumber', n)), { target: { value: fixtureAt(items, item - 1).id } }); }
it.each(['ar', 'en'] as const)('keeps input order, enforces 1/4 bounds and excludes duplicates in %s', async (locale) => {
  state.locale = locale; mount(); const select = screen.getByLabelText(text('performerNumber', 1)) as HTMLSelectElement;
  await waitFor(() => expect(select.options.length).toBe(5)); expect(select.options.item(1)?.text).toBe(locale === 'ar' ? fixtureAt(items, 0).name_ar : 'Synthetic 1'); choose(1, 2);
  expect((screen.getByRole('button', { name: text('removePerformer', 1) }) as HTMLButtonElement).disabled).toBe(true);
  const add = screen.getByText(t(locale, 'serviceSessions.addPerformer')) as HTMLButtonElement;
  for (const n of [2, 3, 4]) { fireEvent.click(add); choose(n, n === 2 ? 1 : n); }
  expect(add.disabled).toBe(true); expect(Array.from(document.querySelectorAll('select'), (select) => select.options.length)).toEqual([2, 2, 2, 2]);
  expect(sessionPerformerInputs(form.getValues('lines.0'))).toEqual([2, 1, 3, 4].map((n) => ({ employee_id: fixtureAt(items, n - 1).id })));
  fireEvent.click(screen.getByRole('button', { name: text('removePerformer', 2) }));
  expect(sessionPerformerInputs(form.getValues('lines.0')).map((row) => row.employee_id)).toEqual([2, 3, 4].map((n) => fixtureAt(items, n - 1).id));
});
it('converts localized 70/30 with contracts, leaves sum validation to the server and shows indexed errors', async () => {
  state.locale = 'en'; const { submit } = mount(); await screen.findByRole('option', { name: 'Synthetic 1' }); choose(1);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.addPerformer') })); choose(2);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.customShares') }));
  for (const [n, value] of [[1, String.fromCharCode(0x667, 0x660)], [2, String.fromCharCode(0x663, 0x660)]] as const) fireEvent.change(screen.getByLabelText(text('share', n)), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' }));
  await waitFor(() => expect(submit).toHaveBeenLastCalledWith([{ employee_id: fixtureAt(items, 0).id, share_bps: 7000 }, { employee_id: fixtureAt(items, 1).id, share_bps: 3000 }]));
  fireEvent.change(screen.getByLabelText(text('share', 2)), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' })); await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
  await act(async () => form.setError('lines.0.performers', { type: 'server', message: 'Indexed server sum error' }));
  expect(screen.getByRole('alert').textContent).toBe('Indexed server sum error');
  await act(async () => form.setError('lines.0.performers.1.share_percentage', { type: 'server', message: 'Indexed server share error' }));
  expect(screen.getByLabelText(text('share', 2)).getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(screen.getByLabelText(text('share', 2)), { target: { value: '30' } });
  expect(screen.queryByRole('alert')).toBeNull(); fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(3));
});
it.each(['', '0', '1.001', '-1', '100.01'])('rejects custom %s without mixed omissions and restores omitted-all equal mode', async (value) => {
  state.locale = 'en'; const { submit } = mount(); await screen.findByRole('option', { name: 'Synthetic 1' }); choose(1);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.customShares') }));
  fireEvent.change(screen.getByLabelText(text('share', 1)), { target: { value } }); fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' }));
  await screen.findByRole('alert'); expect(submit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.equalSplit') }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' })); await waitFor(() => expect(submit).toHaveBeenCalledWith([{ employee_id: fixtureAt(items, 0).id }]));
});
it('uses server-now for dated nonblocking warnings, hides stale search choices immediately and prevents Enter submission', async () => {
  state.locale = 'en'; const { submit } = mount(); await screen.findByRole('option', { name: 'Synthetic 1' }); choose(1);
  expect(screen.getByText(/Not clocked in/).textContent).toContain('Oct 13');
  expect(state.get.mock.lastCall?.[1].params.query.occurred_at).toBe(instant);
  fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' })); await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(fireEvent.keyDown(screen.getByRole('searchbox'), { key: 'Enter' })).toBe(false); expect(submit).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'new' } }); expect(screen.queryByRole('option', { name: 'Synthetic 2' })).toBeNull();
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(fixtureAt(items, 0).id);
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query.q).toBe('new'));
  expect(screen.getByText(/Not clocked in/).textContent).toContain('Oct 13');
});
it('disables fresh reads and reports required performer selection', async () => {
  state.locale = 'en'; const { unmount } = mount(vi.fn(), true); expect(state.get).not.toHaveBeenCalled(); unmount();
  const { submit } = mount(); fireEvent.click(screen.getByRole('button', { name: 'Submit fixture' }));
  await screen.findByRole('alert'); expect(submit).not.toHaveBeenCalled();
});
it('refreshes selected facts through unfiltered pages when search excludes the performer at a new time', async () => {
  state.locale = 'en'; const { rerender, client } = mount(); await screen.findByRole('option', { name: 'Synthetic 1' }); choose(1, 2);
  expect(screen.getByText(/Approved leave/).textContent).toContain('Oct 13');
  const at = '2026-10-12T08:00:00.000Z', context = client.getQueryData(['session-performer-context', 'company', 'business', 'branch', 'actor', 'now']);
  state.get.mockImplementation((path, options) => Promise.resolve({ data: path.endsWith('/recording-context') ? context
    : { items: options.params.query.cursor ? [{ ...fixtureAt(items, 1), not_clocked_in_warning: true, approved_leave_warning: false }] : [fixtureAt(items, 0)], next_cursor: options.params.query.q ? null : options.params.query.cursor ? 'unused' : 'next' } }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'first' } });
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query.q).toBe('first')); expect(screen.getByText(/Approved leave/)).toBeTruthy();
  rerender(<QueryClientProvider client={client}><Harness at={at} /></QueryClientProvider>);
  expect(screen.queryByText(/Approved leave/)).toBeNull(); expect(screen.getByText(/Not checked for this time yet/)).toBeTruthy();
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query.occurred_at).toBe(at));
  expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe(fixtureAt(items, 1).id);
  expect(sessionPerformerInputs(form.getValues('lines.0'))).toEqual([{ employee_id: fixtureAt(items, 1).id }]);
  expect((await screen.findByText(/Not clocked in/)).textContent).toContain('Oct 12'); expect(screen.queryByText(/Approved leave/)).toBeNull();
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('first');
  expect(state.get.mock.calls.filter(([, options]) => options.params.query.limit === 100).map(([, options]) => options.params.query)).toEqual([
    { lang: 'en', occurred_at: at, limit: 100 }, { lang: 'en', occurred_at: at, limit: 100, cursor: 'next' }]);
  rerender(<QueryClientProvider client={client}><Harness at={at} place={{ ...scope, branchId: 'other' }} /></QueryClientProvider>);
  expect(screen.queryByText(/Not clocked in/)).toBeNull(); expect(screen.getByText(/Not checked for this time yet/)).toBeTruthy();
});
it('shows the performer number and sends a digit query', async () => {
  state.locale = 'en';
  mount();
  expect(await screen.findByRole('option', { name: 'Synthetic 1' })).toBeTruthy();
  const numbered = { ...fixtureAt(items, 0), employee_number: 2 };
  state.get.mockImplementation((path, options) => Promise.resolve({
    data: path.endsWith('/recording-context')
      ? { generated_at: instant, business_timezone: 'Asia/Kuwait', recorder_membership_ids: ['01920000-0000-7000-8000-0000000000a1', '01920000-0000-7000-8000-0000000000a2'], recorder_membership_id: null, discount_limit: null }
      : { items: options.params.query.q ? [numbered] : items, next_cursor: null },
  }));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '2' } });
  await waitFor(() => expect(state.get.mock.lastCall?.[1].params.query.q).toBe('2'));
  expect(await screen.findByRole('option', { name: 'Synthetic 1 (2)' })).toBeTruthy();
});
