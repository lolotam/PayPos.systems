import { t, type Locale } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { alertRulesKey } from '@/settings/alert-rules/api/alert-rules-client';
import {
  alertRulesFixture,
  branchA,
  businessId,
  companyId,
  kindRow,
  kindSwitch,
  minutesField,
  refusal,
  renderPage,
  userId,
  withAlertRule,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
const locale = vi.hoisted(() => ({ value: 'en' as Locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => locale.value }));

const businessPath = '/v1/businesses/{businessId}/alert-rules';
const ratingPath = '/v1/businesses/{businessId}/rating-settings';
const listedKinds = [
  'SHIFT_NOT_CLOCKED_IN',
  'SHIFT_BREAK_NOT_RETURNED',
  'SHIFT_BREAK_RETURNED_OTHER_BRANCH',
  'SHIFT_ENDS_SOON',
  'ATTENDANCE_EXCEPTION',
  'DOCUMENT_EXPIRING',
  'LATE_SERVICE_SESSION',
  'SERVICE_LINE_EDITED',
  'SERVICE_LINE_CANCELLED',
  'SERVICE_LINE_PERFORMERS_CHANGED',
  'ATTENDANCE_CHANGE_REQUESTED',
  'ATTENDANCE_CHANGE_DECIDED',
] as const;

function businessView() {
  return withAlertRule(alertRulesFixture(), 'SERVICE_LINE_CANCELLED', { enabled: false });
}

// كارت طلبات التقييم له مساره، فالـ mock بيردّ على كل مسار لوحده. الرد الافتراضي للكارت الجديد
// رفض 403 عشان ما يزاحمش على اختبارات التنبيهات.
function mockGet(rules: (call: number) => unknown, rating: unknown = refusal(403)) {
  let calls = 0;
  api.GET.mockImplementation((path: string) => {
    if (path === ratingPath) return rating;
    const answer = rules(calls);
    calls += 1;
    return answer;
  });
}

const ruleReads = () => api.GET.mock.calls.filter(([path]) => path === businessPath).length;

beforeEach(() => {
  locale.value = 'en';
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('shows only the twelve listed kinds with their server values', async () => {
  mockGet(() => ({ data: businessView() }));
  renderPage();
  const first = (await screen.findByRole('switch', {
    name: t('en', 'alertRules.kind_SHIFT_NOT_CLOCKED_IN'),
  })) as HTMLInputElement;
  expect(first.checked).toBe(true);
  expect(kindSwitch('SERVICE_LINE_CANCELLED').checked).toBe(false);
  expect(screen.getAllByRole('switch')).toHaveLength(13);
  const names = [
    t('en', 'alertRules.masterLabel'),
    ...listedKinds.map((kind) => t('en', `alertRules.kind_${kind}`)),
  ];
  const expected = names.map((name) => screen.getByRole('switch', { name }));
  expect(screen.getAllByRole('switch')).toEqual(expected);
  expect(
    (screen.getByRole('switch', { name: t('en', 'alertRules.masterLabel') }) as HTMLInputElement)
      .checked,
  ).toBe(true);
  expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('20');
  expect(minutesField('SHIFT_ENDS_SOON', 'lead').value).toBe('30');
  const ending = kindRow('SHIFT_ENDS_SOON');
  expect(within(ending).queryByRole('checkbox')).toBeNull();
  expect(within(ending).getByText(t('en', 'alertRules.fixedEmployeePush'))).toBeTruthy();
});

it('shows the source badge of each rule', async () => {
  const view = withAlertRule(businessView(), 'SHIFT_NOT_CLOCKED_IN', { source: 'BUSINESS' });
  mockGet(() => ({ data: view }));
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(within(kindRow('SHIFT_NOT_CLOCKED_IN')).getByText('Business rule')).toBeTruthy();
  expect(within(kindRow('SERVICE_LINE_CANCELLED')).getByText('Default')).toBeTruthy();
});

it('shows a refusal without rows or save', async () => {
  mockGet(() => refusal(403));
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.queryByRole('button', { name: t('en', 'alertRules.save') })).toBeNull();
});

it('shows a read failure and retries it', async () => {
  mockGet((call) =>
    call === 0
      ? {
          error: { code: 'INTERNAL', message_ar: 'Synthetic failure', message_en: 'Synthetic failure' },
          response: { status: 500 },
        }
      : { data: businessView() },
  );
  renderPage();
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic failure');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'pos.retry') }));
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(ruleReads()).toBe(2);
});

it('saves one changed rule and shows the returned state', async () => {
  const initial = withAlertRule(businessView(), 'SHIFT_NOT_CLOCKED_IN', {
    source: 'BUSINESS',
    revision: 7,
    rule_id: branchA.id,
  });
  const returned = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', {
    enabled: false,
    delay_minutes: 15,
    source: 'BUSINESS',
    revision: 8,
  });
  mockGet(() => ({ data: initial }));
  api.PUT.mockResolvedValue({ data: returned });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.click(kindSwitch('SHIFT_NOT_CLOCKED_IN'));
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  expect(kindSwitch('SHIFT_NOT_CLOCKED_IN').checked).toBe(false);
  expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('15');
  expect(within(kindRow('SHIFT_NOT_CLOCKED_IN')).getByText('Business rule')).toBeTruthy();
  const [path, options] = api.PUT.mock.calls[0] ?? [];
  expect(path).toBe(businessPath);
  expect(options.params.header).toEqual({ 'x-company-id': '01920000-0000-7000-8000-0000000000a2' });
  expect(options.body.rules).toHaveLength(1);
  expect(options.body.rules[0]).toEqual(
    expect.objectContaining({
      kind: 'SHIFT_NOT_CLOCKED_IN',
      enabled: false,
      delay_minutes: 15,
      expected_revision: 7,
      expected_rule_id: branchA.id,
    }),
  );
});

it('reports nothing changed without sending a PUT', async () => {
  mockGet(() => ({ data: businessView() }));
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.nothingChanged'))).toBeTruthy();
  expect(api.PUT).not.toHaveBeenCalled();
});

it('shows a revision conflict and resyncs to the refetched values', async () => {
  const initial = withAlertRule(businessView(), 'SHIFT_NOT_CLOCKED_IN', {
    revision: 7,
    rule_id: branchA.id,
  });
  const fresh = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', { delay_minutes: 35, revision: 8 });
  mockGet((call) => ({ data: call === 0 ? initial : fresh }));
  api.PUT.mockResolvedValue({
    error: {
      code: 'ALERT_RULE_REVISION_CONFLICT',
      message_ar: 'Synthetic conflict',
      message_en: 'Synthetic conflict',
    },
    response: { status: 409 },
  });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic conflict');
  await waitFor(() => expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('35'));
  expect(ruleReads()).toBe(2);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.nothingChanged'))).toBeTruthy();
  expect(api.PUT).toHaveBeenCalledTimes(1);
});

it('shows an invalid-rule response and keeps the draft', async () => {
  mockGet(() => ({ data: businessView() }));
  api.PUT.mockResolvedValue({
    error: {
      code: 'ALERT_RULE_INVALID',
      message_ar: 'Synthetic invalid',
      message_en: 'Synthetic invalid',
    },
    response: { status: 422 },
  });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic invalid');
  expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('15');
});

it('disables the save button and rule switches while saving', async () => {
  let release: (value: unknown) => void = () => undefined;
  mockGet(() => ({ data: businessView() }));
  api.PUT.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.click(kindSwitch('SHIFT_NOT_CLOCKED_IN'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalled());
  expect(
    (screen.getByRole('button', { name: t('en', 'alertRules.save') }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(kindSwitch('SHIFT_NOT_CLOCKED_IN').disabled).toBe(true);
  expect(kindSwitch('SERVICE_LINE_CANCELLED').disabled).toBe(true);
  release({ data: businessView() });
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
});

it('switches the business master and shows its off note', async () => {
  mockGet(() => ({ data: businessView() }));
  api.PUT.mockResolvedValue({ data: { ...businessView(), alerts_enabled: false } });
  renderPage();
  const master = await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.click(master);
  expect(await screen.findByText(t('en', 'alertRules.masterOffNote'))).toBeTruthy();
  expect((master as HTMLInputElement).checked).toBe(false);
  expect(api.PUT).toHaveBeenCalledWith(
    '/v1/businesses/{businessId}/alert-rules/master',
    expect.objectContaining({
      body: { alerts_enabled: false },
    }),
  );
});

it('keeps the edited kind concurrency values while refreshing the other kinds', async () => {
  const initial = withAlertRule(businessView(), 'SHIFT_NOT_CLOCKED_IN', {
    revision: 7,
    rule_id: branchA.id,
  });
  const fresh = withAlertRule(
    withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', { delay_minutes: 35, revision: 8 }),
    'SERVICE_LINE_CANCELLED',
    { enabled: true },
  );
  mockGet((call) => ({ data: call === 0 ? initial : fresh }));
  api.PUT.mockResolvedValue({
    data: withAlertRule(fresh, 'SHIFT_NOT_CLOCKED_IN', { delay_minutes: 15, revision: 9 }),
  });
  const { client } = renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: alertRulesKey(companyId, userId, businessId, null),
    });
  });
  await waitFor(() => expect(kindSwitch('SERVICE_LINE_CANCELLED').checked).toBe(true));
  expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('15');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  const body = api.PUT.mock.calls[0]?.[1].body;
  expect(body.rules).toHaveLength(1);
  expect(body.rules[0]).toEqual(
    expect.objectContaining({
      kind: 'SHIFT_NOT_CLOCKED_IN',
      delay_minutes: 15,
      expected_revision: 7,
    }),
  );
});

it('refreshes the business read when the master switch is refused', async () => {
  mockGet(() => ({ data: businessView() }));
  api.PUT.mockResolvedValue({
    error: { code: 'FORBIDDEN', message_ar: 'Synthetic refusal', message_en: 'Synthetic refusal' },
    response: { status: 403 },
  });
  renderPage();
  const master = await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.click(master);
  expect((await screen.findByRole('alert')).textContent).toContain(t('en', 'errors.FORBIDDEN'));
  await waitFor(() => expect(ruleReads()).toBe(2));
});

it('shows the Arabic title and kind labels', async () => {
  locale.value = 'ar';
  mockGet(() => ({ data: businessView() }));
  renderPage();
  expect(await screen.findByText(t('ar', 'alertRules.title'))).toBeTruthy();
  const kind = await screen.findByRole('switch', {
    name: t('ar', 'alertRules.kind_SHIFT_NOT_CLOCKED_IN'),
  });
  expect(kind).toBeTruthy();
});

it('shows the rating requests switch off with its note, and turns it on', async () => {
  mockGet(() => ({ data: businessView() }), { data: { requests_enabled: false } });
  api.PUT.mockResolvedValue({ data: { requests_enabled: true } });
  renderPage();
  const rating = (await screen.findByRole('switch', {
    name: t('en', 'alertRules.ratingRequestsLabel'),
  })) as HTMLInputElement;
  expect(rating.checked).toBe(false);
  expect(await screen.findByText(t('en', 'alertRules.ratingRequestsOffNote'))).toBeTruthy();

  fireEvent.click(rating);
  await waitFor(() => expect(rating.checked).toBe(true));
  expect(screen.queryByText(t('en', 'alertRules.ratingRequestsOffNote'))).toBeNull();
  expect(api.PUT).toHaveBeenCalledWith(
    ratingPath,
    expect.objectContaining({ body: { requests_enabled: true } }),
  );
});

it('hides the rating requests card when the API refuses it', async () => {
  mockGet(() => ({ data: businessView() }), refusal(403));
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(screen.queryByRole('switch', { name: t('en', 'alertRules.ratingRequestsLabel') })).toBeNull();
  expect(screen.queryByText(t('en', 'alertRules.ratingRequestsOffNote'))).toBeNull();
});
