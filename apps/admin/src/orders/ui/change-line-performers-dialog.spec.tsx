import type { ServiceSessionDayPage as DayPage } from '@pospay/contracts';
import { errorMessages, serviceSessionErrors, t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { id, instant, savedLine, scope } from '../model/session-recording-result.fixture';
import type { UnresolvedPerformersChange } from '../api/use-change-line-performers';
import { ChangeLinePerformersDialog } from './change-line-performers-dialog';

const state = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: state.get, PUT: state.put }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

type Line = DayPage['items'][number]['lines'][number];
const nada = { employee_id: id(6), name_en: 'Nada', name_ar: null };
const rana = { employee_id: id(9), name_en: 'Rana', name_ar: null };
const flags = { not_clocked_in_warning: false, approved_leave_warning: false };
const line: Line = {
  id: id(20),
  service_id: id(5),
  ordinal: 1,
  name_en: 'Colour',
  name_ar: null,
  status: 'ACTIVE',
  revision: 3,
  edited: false,
  late: false,
  list_price: '60.000',
  price: '60.000',
  discount: '0.000',
  net: '60.000',
  effective_discount_bps: 0,
  recorded_by: id(4),
  recorded_at: instant,
  has_performer_warning: false,
  performers: [
    { ...nada, share_bps: 7000, ...flags },
    { ...rana, share_bps: 3000, ...flags },
  ],
};
const options = [nada, rana, { employee_id: id(10), name_en: 'Heba', name_ar: null }].map(
  (row, index) => ({
    id: row.employee_id,
    name_en: row.name_en,
    name_ar: null,
    employee_number: index + 1,
    ...flags,
  }),
);
const context = {
  generated_at: instant,
  business_timezone: 'Asia/Kuwait',
  recorder_membership_ids: [id(8)],
  recorder_membership_id: null,
  discount_limit: null,
};
const saved = {
  data: {
    line: {
      ...savedLine,
      id: id(20),
      revision: 4,
      performers_changed_at: '2026-10-17',
    },
    session: { id: id(12), total_net: '60.000' },
  },
  response: { status: 200 },
};
function refused(status: number, code: string, details?: unknown) {
  const text =
    code in serviceSessionErrors
      ? serviceSessionErrors[code as keyof typeof serviceSessionErrors]
      : errorMessages(code as Parameters<typeof errorMessages>[0]);
  return { error: { code, ...text, details }, response: { status } };
}
type Attempts = { current: Map<string, UnresolvedPerformersChange> };
function shown(
  online = true,
  onRefresh = vi.fn().mockResolvedValue(null),
  attempts: Attempts = { current: new Map() },
) {
  const handlers = {
    onSaved: vi.fn(),
    onForbidden: vi.fn(),
    onAccessDenied: vi.fn(),
    onClose: vi.fn(),
    onRefresh,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ChangeLinePerformersDialog
        scope={scope}
        sessionId={id(12)}
        line={line}
        occurredAt={instant}
        online={online}
        attempts={attempts}
        {...handlers}
      />
    </QueryClientProvider>,
  );
  return { ...handlers, unmount: view.unmount };
}
const performerSelect = (n: number) =>
  screen.getByLabelText(
    t('en', 'serviceSessions.performerNumber').replace('{n}', String(n)),
  ) as HTMLSelectElement;
const shareBox = (n: number) =>
  screen.getByLabelText(t('en', 'serviceSessions.share').replace('{n}', String(n)));
const reasonBox = () => screen.getByLabelText(t('en', 'serviceLinePerformers.reason'));
const submitButton = () =>
  screen.getByRole('button', {
    name: new RegExp(
      `${t('en', 'serviceLinePerformers.submit')}|${t('en', 'serviceLinePerformers.submitting')}`,
    ),
  }) as HTMLButtonElement;
const call = (index: number) =>
  state.put.mock.calls[index]?.[1] as {
    body: { performers: unknown[]; reason: string; expected_revision: number } & Record<
      string,
      unknown
    >;
    params: { header: Record<string, string> };
  };
async function ready() {
  await screen.findAllByRole('option', { name: 'Heba (3)' }, { timeout: 4000 });
}
async function sendWith(reason: string) {
  await ready();
  fireEvent.change(reasonBox(), { target: { value: reason } });
  fireEvent.click(submitButton());
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
  state.put.mockReset();
  state.get.mockReset();
  state.get.mockImplementation((path: string) => {
    if (path.endsWith('/recording-context'))
      return Promise.resolve({ data: context, response: { status: 200 } });
    if (path.endsWith('/performer-options'))
      return Promise.resolve({ data: { items: options, next_cursor: null } });
    return Promise.resolve({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
  });
});

it('opens on the saved performers with their 70/30 split and checks them at the visit time', async () => {
  shown();
  await ready();
  const current = screen.getAllByRole('listitem').map((item) => item.textContent);
  expect(current).toEqual(['Nada 70.00%', 'Rana 30.00%']);
  expect(performerSelect(1).value).toBe(id(6));
  expect(performerSelect(2).value).toBe(id(9));
  expect((shareBox(1) as HTMLInputElement).value).toBe('70.00');
  expect((shareBox(2) as HTMLInputElement).value).toBe('30.00');
  const custom = screen.getByRole('button', { name: t('en', 'serviceSessions.customShares') });
  expect(custom.getAttribute('aria-pressed')).toBe('true');
  const optionsCall = state.get.mock.calls.find(([path]) =>
    String(path).endsWith('/performer-options'),
  );
  expect(optionsCall?.[1].params.query.occurred_at).toBe(instant);
});

it('shows the reason message and sends nothing for a blank or 501-character reason', async () => {
  shown();
  await sendWith(' \t\r\n ');
  expect(await screen.findByText(t('en', 'serviceLinePerformers.reasonInvalid'))).toBeTruthy();
  expect(reasonBox().getAttribute('aria-invalid')).toBe('true');
  fireEvent.change(reasonBox(), { target: { value: '😀'.repeat(501) } });
  fireEvent.click(submitButton());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(
    screen.getByText(t('en', 'serviceLinePerformers.reasonCount').replace('{count}', '501')),
  ).toBeTruthy();
  expect(state.put).not.toHaveBeenCalled();
});

it('disables the submit button while offline', async () => {
  shown(false);
  await ready();
  expect(submitButton().disabled).toBe(true);
});

it('shows Saving while the change is in flight and sends the new split, trimmed reason and revision', async () => {
  let answer: (value: unknown) => void = () => undefined;
  state.put.mockReturnValue(new Promise((resolve) => (answer = resolve)));
  const view = shown();
  await ready();
  fireEvent.change(shareBox(1), { target: { value: '60' } });
  fireEvent.change(shareBox(2), { target: { value: '40' } });
  fireEvent.change(reasonBox(), { target: { value: ' Rana did the rinse \n' } });
  fireEvent.click(submitButton());
  await waitFor(() =>
    expect(submitButton().textContent).toBe(t('en', 'serviceLinePerformers.submitting')),
  );
  expect(submitButton().disabled).toBe(true);
  expect(call(0).body).toEqual({
    performers: [
      { employee_id: id(6), share_bps: 6000 },
      { employee_id: id(9), share_bps: 4000 },
    ],
    reason: 'Rana did the rinse',
    expected_revision: 3,
  });
  expect(call(0).params.header['Idempotency-Key']).toEqual(expect.any(String));
  await act(async () => answer(saved));
  await waitFor(() => expect(view.onSaved).toHaveBeenCalled());
});

it('hides the share boxes in equal split and sends the set without shares', async () => {
  state.put.mockResolvedValue(saved);
  shown();
  await ready();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'serviceSessions.equalSplit') }));
  expect(screen.queryByLabelText(t('en', 'serviceSessions.share').replace('{n}', '1'))).toBeNull();
  fireEvent.change(reasonBox(), { target: { value: 'split evenly' } });
  fireEvent.click(submitButton());
  await waitFor(() =>
    expect(call(0).body.performers).toEqual([{ employee_id: id(6) }, { employee_id: id(9) }]),
  );
});

it.each([
  [422, 'SESSION_PERFORMERS_NO_CHANGE'],
  [422, 'SESSION_PERFORMER_SHARES_INVALID'],
  [422, 'SESSION_PERFORMER_NOT_ELIGIBLE'],
  [422, 'SESSION_LINE_IDENTITY_UNKNOWN'],
  [422, 'SESSION_LINE_NOT_EDITABLE'],
  [422, 'SESSION_LINE_PERFORMERS_NOT_CHANGEABLE'],
  [422, 'SESSION_TIME_TOO_OLD'],
  [422, 'IDEMPOTENCY_KEY_REUSED'],
  [422, 'SESSION_PERFORMERS_REASON_INVALID'],
  [409, 'SESSION_LINE_REVISION_STALE'],
] as const)('shows the %s %s message in the dialog', async (status, code) => {
  state.put.mockResolvedValue(
    refused(status, code, status === 409 ? { current_revision: 4 } : { employee_ids: [id(6)] }),
  );
  const view = shown();
  await sendWith('because');
  const message = refused(status, code).error.message_en;
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.queryByText(id(6))).toBeNull();
  expect(submitButton().disabled).toBe(false);
  expect(view.onForbidden).not.toHaveBeenCalled();
});

it('sends the refreshed revision after a stale refusal', async () => {
  state.put.mockResolvedValueOnce(
    refused(409, 'SESSION_LINE_REVISION_STALE', { current_revision: 5 }),
  );
  state.put.mockResolvedValueOnce(saved);
  shown(true, vi.fn().mockResolvedValue({ status: 'ACTIVE', revision: 5 }));
  await sendWith('because');
  expect(
    await screen.findByText(serviceSessionErrors.SESSION_LINE_REVISION_STALE.message_en),
  ).toBeTruthy();
  fireEvent.click(submitButton());
  await waitFor(() => expect(state.put).toHaveBeenCalledTimes(2));
  expect(call(1).body.expected_revision).toBe(5);
  expect(call(1).params.header['Idempotency-Key']).not.toBe(
    call(0).params.header['Idempotency-Key'],
  );
});

it('shows the membership choice after SESSION_CHANGER_MEMBERSHIP_REQUIRED and sends the pick', async () => {
  state.put.mockResolvedValueOnce(
    refused(422, 'SESSION_CHANGER_MEMBERSHIP_REQUIRED', {
      changer_membership_ids: [id(30), id(31)],
    }),
  );
  state.put.mockResolvedValueOnce(saved);
  shown();
  expect(
    screen.queryByRole('combobox', { name: t('en', 'serviceLinePerformers.membership') }),
  ).toBeNull();
  await sendWith('because');
  expect(
    await screen.findByText(serviceSessionErrors.SESSION_CHANGER_MEMBERSHIP_REQUIRED.message_en),
  ).toBeTruthy();
  const select = screen.getByRole('combobox', {
    name: t('en', 'serviceLinePerformers.membership'),
  });
  expect((select as HTMLSelectElement).options).toHaveLength(3);
  fireEvent.change(select, { target: { value: id(31) } });
  fireEvent.click(submitButton());
  await waitFor(() => expect(call(1).body.changer_membership_id).toBe(id(31)));
});

it('freezes the form on an unknown outcome and replays the same body under the same key', async () => {
  state.put.mockRejectedValueOnce(new TypeError('network down'));
  state.put.mockResolvedValueOnce(saved);
  const view = shown();
  await sendWith('because');
  expect(await screen.findByText(t('en', 'serviceLinePerformers.outcomeUnknown'))).toBeTruthy();
  expect((reasonBox() as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(submitButton());
  await waitFor(() => expect(view.onSaved).toHaveBeenCalled());
  expect(call(1).body).toEqual(call(0).body);
  expect(call(1).params.header['Idempotency-Key']).toBe(call(0).params.header['Idempotency-Key']);
});

const keyOf = (index: number) => call(index).params.header['Idempotency-Key'];

it('reopens an unknown outcome with the saved performers named and replays the same key and body', async () => {
  state.put.mockRejectedValueOnce(new TypeError('network down'));
  state.put.mockResolvedValueOnce(saved);
  const attempts: Attempts = { current: new Map() };
  const first = shown(true, vi.fn().mockResolvedValue(null), attempts);
  await sendWith('because');
  expect(await screen.findByText(t('en', 'serviceLinePerformers.outcomeUnknown'))).toBeTruthy();
  first.unmount();
  const again = shown(true, vi.fn().mockResolvedValue(null), attempts);
  expect(screen.getByText(t('en', 'serviceLinePerformers.outcomeUnknown'))).toBeTruthy();
  await ready();
  expect(performerSelect(1).selectedOptions[0]?.textContent).toBe('Nada (1)');
  expect(performerSelect(2).selectedOptions[0]?.textContent).toBe('Rana (2)');
  expect((reasonBox() as HTMLInputElement).value).toBe('because');
  expect((reasonBox() as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(submitButton());
  await waitFor(() => expect(again.onSaved).toHaveBeenCalled());
  expect(call(1).body).toEqual(call(0).body);
  expect(keyOf(1)).toBe(keyOf(0));
});

it('drops the key after a definite 422 so the same body is sent under a new key', async () => {
  state.put.mockResolvedValue(refused(422, 'SESSION_PERFORMERS_NO_CHANGE'));
  shown();
  await sendWith('because');
  const message = serviceSessionErrors.SESSION_PERFORMERS_NO_CHANGE.message_en;
  expect(await screen.findByText(message)).toBeTruthy();
  expect((reasonBox() as HTMLInputElement).disabled).toBe(false);
  fireEvent.click(submitButton());
  await waitFor(() => expect(state.put).toHaveBeenCalledTimes(2));
  expect(call(1).body).toEqual(call(0).body);
  expect(keyOf(1)).not.toBe(keyOf(0));
});

it('keeps the key while the first request is still in progress (non-stale 409)', async () => {
  state.put.mockResolvedValueOnce({
    error: { code: 'IDEMPOTENCY_KEY_IN_PROGRESS', message_ar: 'AR', message_en: 'Still running' },
    response: { status: 409 },
  });
  state.put.mockResolvedValueOnce(saved);
  const view = shown();
  await sendWith('because');
  expect(await screen.findByText(t('en', 'serviceLinePerformers.outcomeUnknown'))).toBeTruthy();
  expect((reasonBox() as HTMLInputElement).disabled).toBe(true);
  fireEvent.click(submitButton());
  await waitFor(() => expect(view.onSaved).toHaveBeenCalled());
  expect(keyOf(1)).toBe(keyOf(0));
});

it('treats an empty 4xx body as a known refusal and frees the key', async () => {
  state.put.mockResolvedValue({ error: '', response: { status: 422 } });
  shown();
  await sendWith('because');
  expect(await screen.findByText(t('en', 'admin.unexpected'))).toBeTruthy();
  expect(screen.queryByText(t('en', 'serviceLinePerformers.outcomeUnknown'))).toBeNull();
  fireEvent.click(submitButton());
  await waitFor(() => expect(state.put).toHaveBeenCalledTimes(2));
  expect(keyOf(1)).not.toBe(keyOf(0));
});
