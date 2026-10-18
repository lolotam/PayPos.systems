import type { ServiceSessionDayPage } from '@pospay/contracts';
import { discountFromPercent, lineNet, parseMoney } from '@pospay/domain';
import { formatKwd, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { resolveEditLine } from '../model/edit-service-line-values';
import { id, instant, scope } from '../model/session-recording-result.fixture';
import { EditServiceLineForm } from './edit-service-line-form';

const state = vi.hoisted(() => ({ patch: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PATCH: state.patch }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
type Line = ServiceSessionDayPage['items'][number]['lines'][number];
const performer = { employee_id: id(6), name_en: 'Nada', name_ar: null, share_bps: 10000, not_clocked_in_warning: false, approved_leave_warning: false };
function dayLine(revision = 1): Line {
  return { id: id(11), service_id: id(5), ordinal: 1, name_en: 'Cut', name_ar: null, status: 'ACTIVE', revision, edited: false,
    list_price: '10.000', price: '10.000', discount: '0.000', net: '10.000', effective_discount_bps: 0, recorded_by: id(4),
    recorded_at: instant, late: false, has_performer_warning: false, performers: [performer] };
}
function refused(status: number, code: string, details?: unknown) {
  return { error: { code, message_ar: `${code} AR`, message_en: `${code} EN`, details }, response: { status } };
}
function shown(line = dayLine(), online = true, onAccessDenied?: (message: string) => void, locks?: { onRequestStart?: () => void; onRequestEnd?: () => void }) {
  const handlers = { onSaved: vi.fn(), onStale: vi.fn(), onForbidden: vi.fn(), onClose: vi.fn(), ...(onAccessDenied ? { onAccessDenied } : {}), ...locks };
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const ui = (next: Line) => <QueryClientProvider client={client}><EditServiceLineForm scope={scope} sessionId={id(12)} line={next} online={online} {...handlers} /></QueryClientProvider>;
  return { client, ui, ...render(ui(line)), ...handlers };
}
const reasonBox = () => screen.getByLabelText(t('en', 'serviceLineEdit.reason'));
const save = () => fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
function fill(text = 'because', price = '10.000', discount = '2.500') {
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.price')), { target: { value: price } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.discountAmount')), { target: { value: discount } });
  fireEvent.change(reasonBox(), { target: { value: text } });
}
const saved = { data: { saved: true, edited: true }, response: { status: 200 } };
const bodyOf = (index: number) => state.patch.mock.calls[index]?.[1].body as { reason: string; expected_revision: number; editor_membership_id?: string };
const keyOf = (index: number) => state.patch.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
async function flushStale(onStale: { mock: { results: { value?: unknown }[] } }) {
  await act(async () => { await onStale.mock.results.at(-1)?.value; });
}

it('requires a reason and counts an emoji as one character through 500', async () => {
  state.patch.mockReset(); state.patch.mockResolvedValue(saved); shown(); save();
  expect(await screen.findByText(t('en', 'serviceLineEdit.reasonInvalid'))).toBeTruthy();
  expect(state.patch).not.toHaveBeenCalled();
  fill('😀'.repeat(501)); save();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(screen.getByText(t('en', 'serviceLineEdit.reasonCount').replace('{count}', '501'))).toBeTruthy();
  expect(state.patch).not.toHaveBeenCalled();
  fireEvent.change(reasonBox(), { target: { value: '😀'.repeat(500) } }); save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  expect(Array.from(bodyOf(0).reason)).toHaveLength(500);
});

it('previews the net with lineNet and discountFromPercent', () => {
  shown(); fill('because');
  const price = parseMoney('10.000');
  expect(screen.getByText(t('en', 'serviceLineEdit.preview'), { exact: false }).textContent).toContain(formatKwd(lineNet(price, parseMoney('2.500'))));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.discountPercent') }));
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.discountPercent')), { target: { value: '10' } });
  const discount = discountFromPercent(price, 1000);
  expect(screen.getByText(t('en', 'serviceLineEdit.preview'), { exact: false }).textContent).toContain(formatKwd(discount));
  expect(screen.getByText(t('en', 'serviceLineEdit.preview'), { exact: false }).textContent).toContain(formatKwd(lineNet(price, discount)));
});

it('sends the revision the form opened with when the line changes in the background', async () => {
  state.patch.mockReset(); state.patch.mockResolvedValue(saved);
  const view = shown(); fill('because', '12.000', '1.000');
  view.rerender(view.ui(dayLine(4))); save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  expect(bodyOf(0).expected_revision).toBe(1);
  expect(view.onStale).not.toHaveBeenCalled();
});

it('shows a stale revision, refetches once, and waits for a second save', async () => {
  state.patch.mockReset(); state.patch.mockResolvedValue(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 2 }));
  const view = shown(); view.onStale.mockResolvedValue(2); fill('because', '12.000', '1.000'); save();
  await waitFor(() => expect(view.onStale).toHaveBeenCalledTimes(1));
  await flushStale(view.onStale);
  expect(state.patch).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement).value).toBe('12.000');
  const refreshed = { ...dayLine(2), price: '11.000', discount: '0.500', net: '10.500' };
  view.rerender(view.ui(refreshed));
  expect(screen.getByText(t('en', 'serviceLineEdit.current'), { exact: false }).textContent).toContain(formatKwd(parseMoney('11.000')));
  save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
  expect(bodyOf(0).expected_revision).toBe(1); expect(bodyOf(1).expected_revision).toBe(2); expect(keyOf(0)).not.toBe(keyOf(1));
});

it('adopts one refreshed revision after a stale save and ignores the next background change', async () => {
  state.patch.mockReset();
  state.patch.mockResolvedValueOnce(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 2 })).mockResolvedValue(saved);
  const view = shown(); view.onStale.mockResolvedValue(2); fill('because', '12.000', '1.000'); save();
  await waitFor(() => expect(view.onStale).toHaveBeenCalledTimes(1));
  await flushStale(view.onStale);
  const refreshed = { ...dayLine(2), price: '11.000', discount: '0.500', net: '10.500' };
  view.rerender(view.ui(refreshed));
  expect(screen.getByText(t('en', 'serviceLineEdit.current'), { exact: false }).textContent).toContain(formatKwd(parseMoney('11.000')));
  view.rerender(view.ui({ ...refreshed, revision: 5, price: '13.000', discount: '0.000', net: '13.000' }));
  save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
  expect(bodyOf(0).expected_revision).toBe(1);
  expect(bodyOf(1).expected_revision).toBe(2);
});

it('adopts the refetched revision when the cached line is already newer', async () => {
  state.patch.mockReset();
  state.patch.mockResolvedValueOnce(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 3 })).mockResolvedValue(saved);
  const view = shown();
  const cached = { ...dayLine(2), price: '11.000', discount: '0.500', net: '10.500' };
  view.rerender(view.ui(cached));
  fill('because', '12.000', '1.000');
  let finish: (revision: number | null) => void = () => undefined;
  view.onStale.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  save();
  await waitFor(() => expect(view.onStale).toHaveBeenCalledTimes(1));
  await act(async () => { finish(3); await view.onStale.mock.results[0]?.value; });
  expect(screen.getByText(t('en', 'serviceLineEdit.current'), { exact: false }).textContent).toContain(formatKwd(parseMoney('11.000')));
  expect((screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement).value).toBe('12.000');
  save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
  expect(bodyOf(0).expected_revision).toBe(1);
  expect(bodyOf(1).expected_revision).toBe(3);
});

it('disables save while a stale refetch is in flight and sends the refreshed revision', async () => {
  state.patch.mockReset();
  state.patch.mockResolvedValueOnce(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 4 })).mockResolvedValue(saved);
  const view = shown();
  let finish: (revision: number | null) => void = () => undefined;
  view.onStale.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  fill('because', '12.000', '1.000');
  save();
  const savingName = t('en', 'serviceLineEdit.saving');
  await waitFor(() => expect((screen.getByRole('button', { name: savingName }) as HTMLButtonElement).disabled).toBe(true));
  expect(state.patch).toHaveBeenCalledTimes(1);
  const form = screen.getByRole('button', { name: savingName }).closest('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('missing form');
  fireEvent.submit(form);
  expect(state.patch).toHaveBeenCalledTimes(1);
  await act(async () => { finish(4); await view.onStale.mock.results[0]?.value; });
  const saveName = t('en', 'serviceLineEdit.save');
  await waitFor(() => expect((screen.getByRole('button', { name: saveName }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: saveName }));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
  expect(bodyOf(0).expected_revision).toBe(1);
  expect(bodyOf(1).expected_revision).toBe(4);
});

it('rejects an amount discount above the price before submit', async () => {
  state.patch.mockReset();
  const resolved = await resolveEditLine({
    price: '5.000', discount_kind: 'AMOUNT', discount_value: '6.000', reason: 'because', expected_revision: 1, editor_membership_id: '',
  }, undefined, { fields: {}, shouldUseNativeValidation: false });
  expect(resolved.errors.discount_value?.message).toBe('discount');
  expect(resolved.values).toEqual({});
  shown(); fill('because', '5.000', '6.000'); save();
  expect(await screen.findByText(t('en', 'serviceSessions.invalidDiscount'))).toBeTruthy();
  expect(state.patch).not.toHaveBeenCalled();
});

it('shows the discount ceiling and accepts a narrow saved body', async () => {
  state.patch.mockReset();
  state.patch.mockResolvedValueOnce(refused(422, 'SESSION_DISCOUNT_ABOVE_LIMIT', { effective_discount_bps: 5000, limit_bps_applied: 2000, minimum_net: '8.000', max_discount_amount: '2.000' }));
  const view = shown(); fill(); save();
  expect(await screen.findByText('8.000')).toBeTruthy();
  expect(screen.getByText('2.000')).toBeTruthy(); expect(screen.getByText('50.00')).toBeTruthy(); expect(screen.getByText('20.00')).toBeTruthy();
  state.patch.mockResolvedValue(saved); save();
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
  expect(bodyOf(0).editor_membership_id).toBeUndefined();
});

it('puts an unchanged edit and an invalid reason on the matching field', async () => {
  state.patch.mockReset();
  state.patch.mockResolvedValueOnce(refused(422, 'SESSION_EDIT_NO_CHANGE')).mockResolvedValueOnce(refused(422, 'SESSION_EDIT_REASON_INVALID'));
  shown(); fill('because', '10.000', '0.000'); save();
  expect(await screen.findByText('SESSION_EDIT_NO_CHANGE EN')).toBeTruthy();
  fireEvent.change(reasonBox(), { target: { value: 'next reason' } }); save();
  expect(await screen.findByText('SESSION_EDIT_REASON_INVALID EN')).toBeTruthy();
});

it('asks for a membership only after the server requires one', async () => {
  state.patch.mockReset();
  state.patch.mockResolvedValueOnce(refused(422, 'SESSION_EDITOR_MEMBERSHIP_REQUIRED', { editor_membership_ids: [id(30), id(31)] })).mockResolvedValue(saved);
  shown(); fill(); save();
  expect(await screen.findByRole('option', { name: t('en', 'serviceLineEdit.membershipN').replace('{n}', '2') })).toBeTruthy();
  expect(bodyOf(0).editor_membership_id).toBeUndefined();
  fireEvent.change(screen.getByRole('combobox', { name: t('en', 'serviceLineEdit.membership') }), { target: { value: id(31) } });
  save(); await waitFor(() => expect(bodyOf(1).editor_membership_id).toBe(id(31)));
});

it('closes the editor when the server forbids the edit', async () => {
  state.patch.mockReset(); state.patch.mockResolvedValue(refused(403, 'FORBIDDEN'));
  const view = shown(); fill(); save();
  await waitFor(() => expect(view.onForbidden).toHaveBeenCalledWith('FORBIDDEN EN'));
  expect(view.onClose).toHaveBeenCalled();
});

it.each([
  [401, 'UNAUTHENTICATED'],
  [403, 'FEATURE_DISABLED'],
] as const)('closes through onAccessDenied when the edit patch returns %s %s', async (status, code) => {
  state.patch.mockReset(); state.patch.mockResolvedValue(refused(status, code));
  const onAccessDenied = vi.fn();
  const view = shown(dayLine(), true, onAccessDenied);
  fill(); save();
  await waitFor(() => expect(onAccessDenied).toHaveBeenCalledWith(`${code} EN`));
  expect(view.onForbidden).not.toHaveBeenCalled();
  expect(view.onClose).toHaveBeenCalled();
});

it('closes through the forbidden callback when a 401 has no access handler', async () => {
  state.patch.mockReset(); state.patch.mockResolvedValue(refused(401, 'UNAUTHENTICATED'));
  const view = shown(); fill(); save();
  await waitFor(() => expect(view.onForbidden).toHaveBeenCalledWith('UNAUTHENTICATED EN'));
  expect(view.onClose).toHaveBeenCalled();
});

function frozenFields() {
  const price = screen.getByLabelText(t('en', 'serviceSessions.price'));
  const discount = screen.getByLabelText(t('en', 'serviceSessions.discountAmount'));
  const reason = reasonBox();
  const percent = screen.getByRole('button', { name: t('en', 'serviceSessions.discountPercent') });
  return [price, discount, reason, percent].every((node) => node instanceof HTMLInputElement || node instanceof HTMLButtonElement ? node.disabled : false);
}

it.each([
  ['network', () => { state.patch.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(saved); }],
  ['500', () => { state.patch.mockResolvedValueOnce(refused(500, 'INTERNAL')).mockResolvedValue(saved); }],
  ['in-progress 409', () => { state.patch.mockResolvedValueOnce(refused(409, 'IDEMPOTENCY_KEY_IN_PROGRESS')).mockResolvedValue(saved); }],
  ['unparsed 200', () => { state.patch.mockResolvedValueOnce({ data: { nope: true }, response: { status: 200 } }).mockResolvedValue(saved); }],
] as const)('freezes the fields after an uncertain %s save and replays the same key and body', async (_label, prepare) => {
  state.patch.mockReset();
  prepare();
  const view = shown();
  fill('because', '12.000', '1.000');
  save();
  expect(await screen.findByText(t('en', 'serviceLineEdit.outcomeUnknown'))).toBeTruthy();
  expect(frozenFields()).toBe(true);
  expect((screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.price')), { target: { value: '3.000' } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.discountAmount')), { target: { value: '0.000' } });
  fireEvent.change(reasonBox(), { target: { value: 'other reason' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.discountPercent') }));
  const sent = state.patch.mock.calls[0]?.[1].body;
  save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).toBe(keyOf(0));
  expect(state.patch.mock.calls[1]?.[1].body).toEqual(sent);
  await waitFor(() => expect(view.onSaved).toHaveBeenCalledTimes(1));
  expect(frozenFields()).toBe(false);
  expect(screen.queryByText(t('en', 'serviceLineEdit.outcomeUnknown'))).toBeNull();
});

it('freezes the membership chosen before an uncertain save and replays it', async () => {
  state.patch.mockReset();
  state.patch.mockResolvedValueOnce(refused(422, 'SESSION_EDITOR_MEMBERSHIP_REQUIRED', { editor_membership_ids: [id(30), id(31)] }))
    .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(saved);
  shown();
  fill('because', '12.000', '1.000');
  save();
  const membership = await screen.findByRole('combobox', { name: t('en', 'serviceLineEdit.membership') });
  fireEvent.change(membership, { target: { value: id(31) } });
  save();
  expect(await screen.findByText(t('en', 'serviceLineEdit.outcomeUnknown'))).toBeTruthy();
  expect((membership as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(membership, { target: { value: id(30) } });
  const sent = state.patch.mock.calls[1]?.[1].body;
  save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(3));
  expect(keyOf(2)).toBe(keyOf(1));
  expect(state.patch.mock.calls[2]?.[1].body).toEqual(sent);
  expect((state.patch.mock.calls[2]?.[1].body as { editor_membership_id?: string }).editor_membership_id).toBe(id(31));
});

it('releases the visit lock when the editor unmounts after an uncertain save', async () => {
  state.patch.mockReset();
  state.patch.mockRejectedValueOnce(new Error('offline'));
  const onRequestStart = vi.fn();
  const onRequestEnd = vi.fn();
  const view = shown(dayLine(), true, undefined, { onRequestStart, onRequestEnd });
  fill();
  save();
  expect(await screen.findByText(t('en', 'serviceLineEdit.outcomeUnknown'))).toBeTruthy();
  expect(onRequestStart).toHaveBeenCalledTimes(1);
  expect(onRequestEnd).not.toHaveBeenCalled();
  view.unmount();
  expect(onRequestEnd).toHaveBeenCalledTimes(1);
});

it('keeps the visit lock until a pending save settles after the editor unmounts', async () => {
  state.patch.mockReset();
  let finish: (value: unknown) => void = () => undefined;
  state.patch.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const onRequestEnd = vi.fn();
  const view = shown(dayLine(), true, undefined, { onRequestEnd });
  fill();
  save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  view.unmount();
  expect(onRequestEnd).not.toHaveBeenCalled();
  await act(async () => { finish(saved); });
  expect(onRequestEnd).toHaveBeenCalledTimes(1);
});

it('does not save offline and submits the open form with Enter', async () => {
  state.patch.mockReset(); state.patch.mockResolvedValue(saved);
  const offline = shown(dayLine(), false);
  expect((screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }) as HTMLButtonElement).disabled).toBe(true);
  offline.unmount();
  shown(); fill();
  fireEvent.keyDown(screen.getByLabelText(t('en', 'serviceSessions.price')), { key: 'Enter' });
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
});
