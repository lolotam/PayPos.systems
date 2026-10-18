import type { SavedServiceLine } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, initial, recordAttempt, response, savedLine, scope } from '../model/session-recording-result.fixture';
import { transitionSessionRecordingResult as transition, type SessionRecordingResult } from '../model/session-recording-result';
import { SessionSavedResult } from './session-saved-result';

const state = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PATCH: state.patch, GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
const editPath = '/v1/businesses/{businessId}/branches/{branchId}/service-sessions/{sessionId}/lines/{lineId}';
const historyKeys = ['was', 'became', 'editor', 'history', 'revision'] as const;
const previousFigures = ['7.125', '0.713', '6.412'];

function visitSession(session: typeof response.session) {
  return transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: { outcome: 'COMPLETE', session, rejected_lines: [] } });
}
function visit(line: SavedServiceLine = savedLine, total = response.session.total_net) {
  return visitSession({ ...response.session, total_net: total, lines: [line] });
}
function refused(status: number, code: string, details?: unknown) {
  return { error: { code, message_ar: `${code} AR`, message_en: `${code} EN`, details }, response: { status } };
}
function shell(result: SessionRecordingResult, online = true) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return <QueryClientProvider client={client}>
    <SessionSavedResult result={result} journal={{ leaveVisit: vi.fn() }} onNewVisit={vi.fn()} scope={scope} online={online} />
  </QueryClientProvider>;
}
function renderVisit(result: SessionRecordingResult, online = true) {
  return render(shell(result, online));
}
const bodyOf = (index: number) => state.patch.mock.calls[index]?.[1].body as { expected_revision: number; price: string; reason: string };
const keyOf = (index: number) => state.patch.mock.calls[index]?.[1].params.header['Idempotency-Key'] as string;
function noHistoryRead() {
  expect(state.get).not.toHaveBeenCalled();
  for (const call of state.patch.mock.calls) expect(call[0]).toBe(editPath);
}
function fill(price = '8.000', discount = '1.000') {
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.price')), { target: { value: price } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.discountAmount')), { target: { value: discount } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'because' } });
}
const editButton = () => fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.edit') }));
const save = () => fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));

it('hides figures after one stale retry and a narrow save, then edits again without old numbers', async () => {
  state.patch.mockReset(); state.get.mockReset();
  state.patch.mockResolvedValueOnce(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 4 }))
    .mockResolvedValue({ data: { saved: true, edited: true }, response: { status: 200 } });
  const view = renderVisit(visit());
  editButton(); fill(); save();
  expect(await screen.findByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceLineEdit.edited'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceSessions.savedTotal'))).toBeNull();
  for (const figure of previousFigures) expect(view.container.textContent).not.toContain(figure);
  for (const key of historyKeys) expect(screen.queryByText(t('en', `serviceLineEdit.${key}`))).toBeNull();
  expect(state.patch).toHaveBeenCalledTimes(2);
  expect(bodyOf(0).expected_revision).toBe(1); expect(bodyOf(1).expected_revision).toBe(4);
  expect(bodyOf(0).price).toBe(bodyOf(1).price); expect(bodyOf(0).reason).toBe(bodyOf(1).reason);
  expect(keyOf(0)).not.toBe(keyOf(1));
  noHistoryRead();
  editButton();
  expect((screen.getByLabelText(t('en', 'serviceSessions.price')) as HTMLInputElement).value).toBe('');
  expect(screen.queryByText(t('en', 'serviceLineEdit.current'))).toBeNull();
  for (const figure of previousFigures) expect(view.container.textContent).not.toContain(figure);
  fill('8.500', '0.500'); save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(3));
  expect(bodyOf(2).expected_revision).toBe(5);
  noHistoryRead();
});

it('shows the line and the visit total from a full edit response', async () => {
  state.patch.mockReset(); state.get.mockReset();
  const line = { ...savedLine, price: '9.500', discount: '1.000', net: '8.500', revision: 2, edited: true as const };
  state.patch.mockResolvedValue({ data: { line, session: { id: id(12), total_net: '8.500' } }, response: { status: 200 } });
  const view = renderVisit(visit());
  editButton(); fill('9.500', '1.000'); save();
  expect(await screen.findByText(t('en', 'serviceLineEdit.edited'))).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceSessions.savedTotal')).textContent).toContain('8.500');
  expect(view.container.textContent).toContain('9.500');
  expect(view.container.textContent).toContain('1.000');
  for (const figure of previousFigures) expect(view.container.textContent).not.toContain(figure);
  expect(screen.queryByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeNull();
  for (const key of historyKeys) expect(screen.queryByText(t('en', `serviceLineEdit.${key}`))).toBeNull();
  noHistoryRead();
});

it('shows a second stale response as an error and stops after two requests', async () => {
  state.patch.mockReset(); state.get.mockReset();
  state.patch.mockResolvedValueOnce(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 3 }))
    .mockResolvedValueOnce(refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 4 }));
  renderVisit(visit());
  editButton(); fill(); save();
  expect((await screen.findByRole('alert')).textContent).toContain('SESSION_LINE_REVISION_STALE EN');
  expect(state.patch).toHaveBeenCalledTimes(2);
  expect(bodyOf(1).expected_revision).toBe(3);
  expect(keyOf(0)).not.toBe(keyOf(1));
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
  noHistoryRead();
});

it('does not mark a line from its revision and offers no edit on a cancelled line', () => {
  state.get.mockReset(); state.patch.mockReset();
  const unmarked = renderVisit(visit({ ...savedLine, revision: 5 }));
  expect(screen.queryByText(t('en', 'serviceLineEdit.edited'))).toBeNull();
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeTruthy();
  unmarked.unmount();
  const marked = renderVisit(visit({ ...savedLine, edited: true }));
  expect(screen.getByText(t('en', 'serviceLineEdit.edited'))).toBeTruthy();
  marked.unmount();
  renderVisit(visit({ ...savedLine, status: 'CANCELLED' }));
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeNull();
  noHistoryRead();
});

it('closes the editor on a refusal and disables save while offline', async () => {
  state.patch.mockReset(); state.get.mockReset();
  state.patch.mockResolvedValue(refused(403, 'FORBIDDEN'));
  const view = renderVisit(visit());
  editButton(); fill(); save();
  expect((await screen.findByRole('alert')).textContent).toContain('FORBIDDEN EN');
  expect(screen.queryByLabelText(t('en', 'serviceLineEdit.reason'))).toBeNull();
  expect(state.patch).toHaveBeenCalledTimes(1);
  noHistoryRead();
  view.unmount();
  state.patch.mockClear();
  renderVisit(visit(), false);
  editButton();
  expect((screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }) as HTMLButtonElement).disabled).toBe(true);
  expect(state.patch).not.toHaveBeenCalled();
});

it('keeps the edited mark and shows the fresh snapshot after an append replaces the session object', async () => {
  state.patch.mockReset(); state.get.mockReset();
  state.patch.mockResolvedValue({ data: { saved: true, edited: true }, response: { status: 200 } });
  const view = renderVisit(visit());
  editButton(); fill(); save();
  expect(await screen.findByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  editButton();
  const refreshed = { ...savedLine, price: '4.250', discount: '0.250', net: '4.000', revision: 3 };
  const appended = { ...savedLine, id: id(19), name_en: 'Appended service', ordinal: 2, price: '2.000', discount: '0.000', net: '2.000', revision: 1 };
  view.rerender(shell(visitSession({ ...response.session, total_net: '6.250', lines: [refreshed, appended] })));
  expect(screen.getAllByText(t('en', 'serviceLineEdit.edited'))).toHaveLength(1);
  expect(screen.queryByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeNull();
  expect(screen.queryByLabelText(t('en', 'serviceLineEdit.reason'))).toBeNull();
  expect(screen.getByText(t('en', 'serviceSessions.savedTotal')).textContent).toContain('6.250');
  expect(view.container.textContent).toContain('4.250');
  expect(view.container.textContent).toContain('Appended service');
  expect(view.container.textContent).not.toContain('7.125');
});

it('drops the edited mark when the session id changes', async () => {
  state.patch.mockReset(); state.get.mockReset();
  state.patch.mockResolvedValue({ data: { saved: true, edited: true }, response: { status: 200 } });
  const view = renderVisit(visit());
  editButton(); fill(); save();
  expect(await screen.findByText(t('en', 'serviceLineEdit.edited'))).toBeTruthy();
  const session = { ...response.session, id: id(30), total_net: '1.400', lines: [{ ...savedLine, price: '1.500', discount: '0.100', net: '1.400' }] };
  view.rerender(shell(visitSession(session)));
  expect(screen.queryByText(t('en', 'serviceLineEdit.edited'))).toBeNull();
  expect(screen.queryByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeNull();
  expect(screen.getByText(t('en', 'serviceSessions.savedTotal')).textContent).toContain('1.400');
  expect(view.container.textContent).toContain('1.500');
  expect(view.container.textContent).not.toContain('7.125');
});

const moneyLabels = ['price', 'discountAmount', 'savedNet', 'savedTotal'] as const;
function expectAccessErrorOnly(view: { container: HTMLElement }) {
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  for (const key of moneyLabels) expect(screen.queryByText(t('en', `serviceSessions.${key}`))).toBeNull();
  for (const figure of previousFigures) expect(view.container.textContent).not.toContain(figure);
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.retry') })).toBeNull();
  expect(screen.getByText('Synthetic customer')).toBeTruthy();
}
async function denyEdit(status: number, code: string) {
  state.patch.mockReset(); state.get.mockReset();
  state.patch.mockResolvedValue(refused(status, code));
  const view = renderVisit(visit());
  editButton(); fill(); save();
  expect((await screen.findByRole('alert')).textContent).toContain(`${code} EN`);
  return view;
}

it.each([
  [401, 'UNAUTHENTICATED'],
  [403, 'FEATURE_DISABLED'],
] as const)('replaces the saved visit with only the access error when the edit patch returns %s %s', async (status, code) => {
  const view = await denyEdit(status, code);
  expectAccessErrorOnly(view);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisit') }));
  expectAccessErrorOnly(view);
  expect(screen.getByRole('button', { name: t('en', 'serviceSessions.newVisitSameCustomer') })).toBeTruthy();
});

it('keeps the saved figures when the edit patch returns 403 FORBIDDEN', async () => {
  state.patch.mockReset(); state.get.mockReset();
  state.patch.mockResolvedValue(refused(403, 'FORBIDDEN'));
  const view = renderVisit(visit());
  editButton(); fill(); save();
  expect((await screen.findByRole('alert')).textContent).toContain('FORBIDDEN EN');
  expect(screen.getByText(t('en', 'serviceSessions.savedTotal')).textContent).toContain('6.412');
  expect(view.container.textContent).toContain('7.125');
  expect(screen.getByText(t('en', 'serviceSessions.discountAmount'))).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceSessions.savedNet'))).toBeTruthy();
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeTruthy();
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.retry') })).toBeNull();
});

it('keeps the saved visit hidden when an append replaces the session object after a denial', async () => {
  const view = await denyEdit(401, 'UNAUTHENTICATED');
  const refreshed = { ...savedLine, price: '4.250', discount: '0.250', net: '4.000', revision: 3 };
  const appended = { ...savedLine, id: id(19), name_en: 'Appended service', ordinal: 2, price: '2.000', discount: '0.000', net: '2.000', revision: 1 };
  view.rerender(shell(visitSession({ ...response.session, total_net: '6.250', lines: [refreshed, appended] })));
  expect((screen.getByRole('alert')).textContent).toContain('UNAUTHENTICATED EN');
  expectAccessErrorOnly(view);
  expect(view.container.textContent).not.toContain('Appended service');
  expect(view.container.textContent).not.toContain('4.250');
});

it('shows the lines again when the session id changes after a denial', async () => {
  const view = await denyEdit(403, 'FEATURE_DISABLED');
  const session = { ...response.session, id: id(30), total_net: '1.400', lines: [{ ...savedLine, price: '1.500', discount: '0.100', net: '1.400' }] };
  view.rerender(shell(visitSession(session)));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText(t('en', 'serviceSessions.savedTotal')).textContent).toContain('1.400');
  expect(view.container.textContent).toContain('1.500');
  expect(screen.getByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeTruthy();
  expect(view.container.textContent).not.toContain('7.125');
});

it('does not offer an edit while the saved visit is frozen', () => {
  const result = visit();
  renderVisit({ ...result, feedback: { kind: 'UNRESOLVED' } });
  expect(screen.queryByRole('button', { name: t('en', 'serviceLineEdit.edit') })).toBeNull();
  expect(screen.getByText(t('en', 'serviceSessions.savedTotal'))).toBeTruthy();
});
