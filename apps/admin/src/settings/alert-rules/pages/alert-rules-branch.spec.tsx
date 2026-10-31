import { t } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { alertRulesKey } from '@/settings/alert-rules/api/alert-rules-client';
import {
  alertRulesFixture,
  branchA,
  branchB,
  businessId,
  companyId,
  kindRow,
  kindSwitch,
  minutesField,
  mockAlertRulesGet,
  renderPage,
  userId,
  withAlertRule,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const businessPath = '/v1/businesses/{businessId}/alert-rules';
const branchPath = '/v1/businesses/{businessId}/branches/{branchId}/alert-rules';
const resetName = `${t('en', 'alertRules.resetToBusinessText')} — ${t('en', 'alertRules.kind_SHIFT_NOT_CLOCKED_IN')}`;

function branchView() {
  return withAlertRule({ ...alertRulesFixture(), branch_id: branchA.id }, 'SHIFT_NOT_CLOCKED_IN', {
    source: 'BRANCH',
    revision: 9,
    rule_id: branchB.id,
  });
}

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('selects a branch and hides document expiry there', async () => {
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) =>
      Promise.resolve({ data: path === businessPath ? alertRulesFixture() : branchView() }),
    ),
  );
  renderPage({ branches: [branchA, branchB] });
  const selector = (await screen.findByLabelText(
    t('en', 'alertRules.scopeLabel'),
  )) as HTMLSelectElement;
  expect(
    within(selector).getByRole('option', { name: t('en', 'alertRules.scopeBusiness') }),
  ).toBeTruthy();
  expect(within(selector).getByRole('option', { name: branchA.name_en })).toBeTruthy();
  expect(within(selector).getByRole('option', { name: branchB.name_en })).toBeTruthy();
  fireEvent.change(selector, { target: { value: branchA.id } });
  expect(await screen.findByText(t('en', 'alertRules.documentExpiryBranchNote'))).toBeTruthy();
  expect(api.GET).toHaveBeenCalledWith(
    branchPath,
    expect.objectContaining({
      params: expect.objectContaining({
        path: { businessId: expect.any(String), branchId: branchA.id },
      }),
    }),
  );
  expect(
    screen.queryByRole('switch', { name: t('en', 'alertRules.kind_DOCUMENT_EXPIRING') }),
  ).toBeNull();
  expect(screen.getByText(t('en', 'alertRules.documentExpiryBranchNote'))).toBeTruthy();
});

it('resets only a branch override and shows the business source afterwards', async () => {
  const initial = withAlertRule(branchView(), 'SERVICE_LINE_CANCELLED', { source: 'BUSINESS' });
  const returned = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', {
    source: 'BUSINESS',
    revision: null,
    rule_id: null,
  });
  let branchReads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) => {
      if (path === businessPath) return Promise.resolve({ data: alertRulesFixture() });
      branchReads += 1;
      return Promise.resolve({ data: branchReads === 1 ? initial : returned });
    }),
  );
  api.DELETE.mockResolvedValue({ data: undefined, response: { status: 204 } });
  renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  expect(await screen.findByRole('button', { name: resetName })).toBeTruthy();
  expect(within(kindRow('SERVICE_LINE_CANCELLED')).queryByRole('button')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: resetName }));
  expect(await screen.findByText(t('en', 'alertRules.resetDone'))).toBeTruthy();
  expect(api.DELETE).toHaveBeenCalledWith(
    `${branchPath}/{kind}`,
    expect.objectContaining({
      params: expect.objectContaining({
        path: {
          businessId: expect.any(String),
          branchId: branchA.id,
          kind: 'SHIFT_NOT_CLOCKED_IN',
        },
        query: { expected_rule_id: branchB.id, expected_revision: 9 },
      }),
    }),
  );
  await waitFor(() =>
    expect(within(kindRow('SHIFT_NOT_CLOCKED_IN')).getByText('Business rule')).toBeTruthy(),
  );
  expect(screen.queryByRole('button', { name: resetName })).toBeNull();
});

it('saves branch changes to the branch path', async () => {
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) =>
      Promise.resolve({ data: path === businessPath ? alertRulesFixture() : branchView() }),
    ),
  );
  api.PUT.mockResolvedValue({ data: branchView() });
  renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  await screen.findByRole('button', { name: resetName });
  fireEvent.click(kindSwitch('SHIFT_NOT_CLOCKED_IN'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  expect(api.PUT.mock.calls[0]?.[0]).toBe(branchPath);
  expect(api.PUT.mock.calls[0]?.[1].params.path.branchId).toBe(branchA.id);
});

it('resets with the edited form revision after a background refetch', async () => {
  const initial = withAlertRule(
    { ...alertRulesFixture(), branch_id: branchA.id },
    'SHIFT_NOT_CLOCKED_IN',
    { source: 'BRANCH', delay_minutes: 10, revision: 7, rule_id: branchB.id },
  );
  const fresh = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', {
    delay_minutes: 35,
    revision: 8,
  });
  let branchReads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) => {
      if (path === businessPath) return Promise.resolve({ data: alertRulesFixture() });
      branchReads += 1;
      return Promise.resolve({ data: branchReads === 1 ? initial : fresh });
    }),
  );
  api.DELETE.mockResolvedValue({
    error: {
      code: 'ALERT_RULE_REVISION_CONFLICT',
      message_ar: 'Synthetic reset conflict',
      message_en: 'Synthetic reset conflict',
    },
    response: { status: 409 },
  });
  const { client } = renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  await screen.findByRole('button', { name: resetName });
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: alertRulesKey(companyId, userId, businessId, branchA.id),
    });
  });
  expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('15');
  fireEvent.click(screen.getByRole('button', { name: resetName }));
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic reset conflict');
  expect(api.DELETE.mock.calls[0]?.[1].params.query).toEqual({
    expected_rule_id: branchB.id,
    expected_revision: 7,
  });
});

it('replaces the reset kind and preserves the other edited kinds', async () => {
  const initial = withAlertRule(
    { ...alertRulesFixture(), branch_id: branchA.id },
    'SHIFT_NOT_CLOCKED_IN',
    { source: 'BRANCH', delay_minutes: 10, revision: 7, rule_id: branchB.id },
  );
  const returned = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', {
    source: 'BUSINESS',
    delay_minutes: 20,
    revision: null,
    rule_id: null,
  });
  let branchReads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) => {
      if (path === businessPath) return Promise.resolve({ data: alertRulesFixture() });
      branchReads += 1;
      return Promise.resolve({ data: branchReads === 1 ? initial : returned });
    }),
  );
  api.DELETE.mockResolvedValue({ data: undefined, response: { status: 204 } });
  api.PUT.mockResolvedValue({
    data: withAlertRule(returned, 'SERVICE_LINE_CANCELLED', { enabled: false }),
  });
  renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  await screen.findByRole('button', { name: resetName });
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  fireEvent.click(kindSwitch('SERVICE_LINE_CANCELLED'));
  fireEvent.click(screen.getByRole('button', { name: resetName }));
  expect(await screen.findByText(t('en', 'alertRules.resetDone'))).toBeTruthy();
  await waitFor(() => expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('20'));
  expect(within(kindRow('SHIFT_NOT_CLOCKED_IN')).getByText('Business rule')).toBeTruthy();
  expect(kindSwitch('SERVICE_LINE_CANCELLED').checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
  const body = api.PUT.mock.calls[0]?.[1].body;
  expect(body.rules).toHaveLength(1);
  expect(body.rules[0].kind).toBe('SERVICE_LINE_CANCELLED');
});

it('hides the scope selector when there are no active branches', async () => {
  api.GET.mockImplementation(
    mockAlertRulesGet(() => Promise.resolve({ data: alertRulesFixture() })),
  );
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(screen.queryByLabelText(t('en', 'alertRules.scopeLabel'))).toBeNull();
});
