import { t } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { alertRulesKey } from '@/settings/alert-rules/api/alert-rules-client';
import {
  alertRulesFixture,
  branchA,
  branchB,
  businessId,
  companyId,
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
const masterPath = '/v1/businesses/{businessId}/alert-rules/master';
const resetName = `${t('en', 'alertRules.resetToBusinessText')} — ${t('en', 'alertRules.kind_SHIFT_NOT_CLOCKED_IN')}`;

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('keeps the draft and offers retry when the refetch after a save conflict fails', async () => {
  const initial = withAlertRule(alertRulesFixture(), 'SHIFT_NOT_CLOCKED_IN', {
    source: 'BUSINESS',
    delay_minutes: 20,
    revision: 1,
    rule_id: branchB.id,
  });
  let reads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet(() => {
      reads += 1;
      if (reads === 1) return Promise.resolve({ data: initial });
      return Promise.resolve({
        error: {
          code: 'INTERNAL',
          message_ar: 'Synthetic save read failure',
          message_en: 'Synthetic save read failure',
        },
        response: { status: 500 },
      });
    }),
  );
  api.PUT.mockResolvedValue({
    error: {
      code: 'ALERT_RULE_REVISION_CONFLICT',
      message_ar: 'Synthetic save conflict',
      message_en: 'Synthetic save conflict',
    },
    response: { status: 409 },
  });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText('Synthetic save conflict')).toBeTruthy();
  expect(await screen.findByText('Synthetic save read failure')).toBeTruthy();
  expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('15');
  expect(screen.getByRole('button', { name: t('en', 'pos.retry') })).toBeTruthy();
});

it('does not announce a reset when its refetch fails', async () => {
  const initial = withAlertRule(
    { ...alertRulesFixture(), branch_id: branchA.id },
    'SHIFT_NOT_CLOCKED_IN',
    { source: 'BRANCH', delay_minutes: 10, revision: 7, rule_id: branchB.id },
  );
  let branchReads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) => {
      if (path === businessPath) return Promise.resolve({ data: alertRulesFixture() });
      branchReads += 1;
      if (branchReads === 1) return Promise.resolve({ data: initial });
      return Promise.resolve({
        error: {
          code: 'INTERNAL',
          message_ar: 'Synthetic reset read failure',
          message_en: 'Synthetic reset read failure',
        },
        response: { status: 500 },
      });
    }),
  );
  api.DELETE.mockResolvedValue({ data: undefined, response: { status: 204 } });
  renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  fireEvent.click(await screen.findByRole('button', { name: resetName }));
  expect(await screen.findByText('Synthetic reset read failure')).toBeTruthy();
  expect(screen.queryByText(t('en', 'alertRules.resetDone'))).toBeNull();
});

it('disables every write control while a master or save write is pending', async () => {
  const view = withAlertRule(
    { ...alertRulesFixture(), branch_id: branchA.id },
    'SHIFT_NOT_CLOCKED_IN',
    { source: 'BRANCH', delay_minutes: 10, revision: 7, rule_id: branchB.id },
  );
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) =>
      Promise.resolve({ data: path === businessPath ? alertRulesFixture() : view }),
    ),
  );
  let releaseMaster: (value: unknown) => void = () => undefined;
  let releaseSave: (value: unknown) => void = () => undefined;
  api.PUT.mockImplementation((path: string) =>
    path === masterPath
      ? new Promise((resolve) => {
          releaseMaster = resolve;
        })
      : new Promise((resolve) => {
          releaseSave = resolve;
        }),
  );
  renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  await screen.findByRole('button', { name: resetName });
  fireEvent.click(screen.getByRole('switch', { name: t('en', 'alertRules.masterLabel') }));
  await waitFor(() => {
    expect(
      (screen.getByRole('button', { name: t('en', 'alertRules.save') }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(kindSwitch('SHIFT_NOT_CLOCKED_IN').disabled).toBe(true);
    expect((screen.getByRole('button', { name: resetName }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
  releaseMaster({ data: { ...view, branch_id: null, alerts_enabled: false } });
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: t('en', 'alertRules.save') }) as HTMLButtonElement)
        .disabled,
    ).toBe(false),
  );
  fireEvent.click(kindSwitch('SHIFT_NOT_CLOCKED_IN'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  await waitFor(() =>
    expect(
      (screen.getByRole('switch', { name: t('en', 'alertRules.masterLabel') }) as HTMLInputElement)
        .disabled,
    ).toBe(true),
  );
  releaseSave({ data: withAlertRule(view, 'SHIFT_NOT_CLOCKED_IN', { enabled: false }) });
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
});

it('treats missing reset concurrency values as a conflict and uses the override afterwards', async () => {
  const initial = withAlertRule(
    { ...alertRulesFixture(), branch_id: branchA.id },
    'SHIFT_NOT_CLOCKED_IN',
    { source: 'BUSINESS', delay_minutes: 20, revision: null, rule_id: null },
  );
  const override = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', {
    source: 'BRANCH',
    delay_minutes: 12,
    revision: 4,
    rule_id: branchB.id,
  });
  let branchReads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) => {
      if (path === businessPath) return Promise.resolve({ data: alertRulesFixture() });
      branchReads += 1;
      return Promise.resolve({ data: branchReads === 1 ? initial : override });
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
  await screen.findByText(t('en', 'alertRules.documentExpiryBranchNote'));
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: alertRulesKey(companyId, userId, businessId, branchA.id),
    });
  });
  fireEvent.click(await screen.findByRole('button', { name: resetName }));
  expect(api.DELETE).not.toHaveBeenCalled();
  expect((await screen.findByRole('alert')).textContent).toContain(
    t('en', 'errors.ALERT_RULE_REVISION_CONFLICT'),
  );
  await waitFor(() => expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('12'));
  fireEvent.click(screen.getByRole('button', { name: resetName }));
  await waitFor(() => expect(api.DELETE).toHaveBeenCalledTimes(1));
  expect(api.DELETE.mock.calls[0]?.[1].params.query).toEqual({
    expected_rule_id: branchB.id,
    expected_revision: 4,
  });
});
