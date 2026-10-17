import type { ServiceSessionDayPage } from '@pospay/contracts';
import { discountFromPercent, lineNet, parseMoney } from '@pospay/domain';
import { formatKwd, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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
function shown(line = dayLine(), online = true) {
  const handlers = { onSaved: vi.fn(), onStale: vi.fn(), onForbidden: vi.fn(), onClose: vi.fn() };
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

it('shows a stale revision, refetches once, and waits for a second save', async () => {
  state.patch.mockReset(); state.patch.mockResolvedValue(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 2 }));
  const view = shown(); fill('because', '12.000', '1.000'); save();
  await waitFor(() => expect(view.onStale).toHaveBeenCalledTimes(1));
  expect(state.patch).toHaveBeenCalledTimes(1);
  expect((screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement).value).toBe('12.000');
  view.rerender(view.ui(dayLine(2))); save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
  expect(bodyOf(0).expected_revision).toBe(1); expect(bodyOf(1).expected_revision).toBe(2); expect(keyOf(0)).not.toBe(keyOf(1));
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

it('does not save offline and submits the open form with Enter', async () => {
  state.patch.mockReset(); state.patch.mockResolvedValue(saved);
  const offline = shown(dayLine(), false);
  expect((screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }) as HTMLButtonElement).disabled).toBe(true);
  offline.unmount();
  shown(); fill();
  fireEvent.keyDown(screen.getByLabelText(t('en', 'serviceSessions.price')), { key: 'Enter' });
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
});
