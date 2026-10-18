import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { id, initial, recordAttempt, response, savedLine, scope } from '../model/session-recording-result.fixture';
import { transitionSessionRecordingResult as transition } from '../model/session-recording-result';
import { SessionSavedResult } from './session-saved-result';

const state = vi.hoisted(() => ({ patch: vi.fn(), get: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ PATCH: state.patch, GET: state.get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const narrow = { data: { saved: true, edited: true }, response: { status: 200 } };
const full = {
  data: {
    line: { ...savedLine, price: '4.250', discount: '0.250', net: '4.000', revision: 2, edited: true as const },
    session: { id: id(12), total_net: '4.000' },
  },
  response: { status: 200 },
};
type PatchResult = typeof full | typeof narrow;

function renderTwoLines() {
  const second = { ...savedLine, id: id(19), name_en: 'Second service', ordinal: 2 };
  const session = { ...response.session, lines: [savedLine, second] };
  const result = transition(initial, { type: 'RECORDED', attempt: recordAttempt, response: { outcome: 'COMPLETE', session, rejected_lines: [] } });
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false }, queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <SessionSavedResult result={result} journal={{ leaveVisit: vi.fn() }} onNewVisit={vi.fn()} scope={scope} online />
  </QueryClientProvider>);
}
function editAt(index: number) {
  const button = screen.getAllByRole('button', { name: t('en', 'serviceLineEdit.edit') })[index];
  if (!button) throw new Error(`missing edit ${index}`);
  fireEvent.click(button);
}
function fill(price: string, discount: string) {
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.price')), { target: { value: price } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceSessions.discountAmount')), { target: { value: discount } });
  fireEvent.change(screen.getByLabelText(t('en', 'serviceLineEdit.reason')), { target: { value: 'because' } });
}
const save = () => fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceLineEdit.save') }));
const reason = () => screen.queryByLabelText(t('en', 'serviceLineEdit.reason'));

async function submitBoth() {
  const resolvers: Array<(value: PatchResult) => void> = [];
  state.patch.mockReset();
  state.get.mockReset();
  state.patch.mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve); }));
  const view = renderTwoLines();
  editAt(0);
  fill('8.000', '1.000');
  save();
  await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(1));
  editAt(1);
  fill('9.500', '0.500');
  save();
  await waitFor(() => expect(resolvers).toHaveLength(2));
  return { view, resolvers };
}
function settle(resolvers: Array<(value: PatchResult) => void>, index: number, value: PatchResult) {
  const resolve = resolvers[index];
  if (!resolve) throw new Error(`missing response ${index}`);
  resolve(value);
}

it('keeps the open editor and both line outcomes when the earlier full edit finishes first', async () => {
  const { view, resolvers } = await submitBoth();
  settle(resolvers, 0, full);
  expect(await screen.findByText('4.250')).toBeTruthy();
  expect(reason()).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeNull();
  expect(screen.getAllByText(t('en', 'serviceLineEdit.edited'))).toHaveLength(1);
  settle(resolvers, 1, narrow);
  expect(await screen.findByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  expect(reason()).toBeNull();
  expect(view.container.textContent).toContain('4.250');
  expect(screen.getAllByText(t('en', 'serviceLineEdit.edited'))).toHaveLength(2);
  expect(view.container.textContent).not.toContain('7.125');
  expect(screen.queryByText(t('en', 'serviceSessions.savedTotal'))).toBeNull();
  expect(state.patch).toHaveBeenCalledTimes(2);
  expect(state.get).not.toHaveBeenCalled();
});

it('keeps both line outcomes when the later narrow edit finishes before the earlier full edit', async () => {
  const { view, resolvers } = await submitBoth();
  settle(resolvers, 1, narrow);
  expect(await screen.findByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  expect(reason()).toBeNull();
  expect(view.container.textContent).toContain('7.125');
  expect(screen.getAllByText(t('en', 'serviceLineEdit.edited'))).toHaveLength(1);
  settle(resolvers, 0, full);
  expect(await screen.findByText('4.250')).toBeTruthy();
  expect(screen.getByText(t('en', 'serviceLineEdit.figuresHidden'))).toBeTruthy();
  expect(reason()).toBeNull();
  expect(screen.getAllByText(t('en', 'serviceLineEdit.edited'))).toHaveLength(2);
  expect(screen.getByText(t('en', 'serviceSessions.savedTotal')).textContent).toContain('4.000');
  expect(view.container.textContent).not.toContain('7.125');
  expect(state.patch).toHaveBeenCalledTimes(2);
  expect(state.get).not.toHaveBeenCalled();
});
