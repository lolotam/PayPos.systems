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
  minutesField,
  renderPage,
  userId,
  withAlertRule,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const businessPath = '/v1/businesses/{businessId}/alert-rules';
const resetName = `${t('en', 'alertRules.resetToBusinessText')} — ${t('en', 'alertRules.kind_SHIFT_NOT_CLOCKED_IN')}`;

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('replaces the draft after a save conflict even when the refetch is identical', async () => {
  const initial = withAlertRule(alertRulesFixture(), 'SHIFT_NOT_CLOCKED_IN', {
    source: 'BUSINESS',
    delay_minutes: 20,
    revision: 1,
    rule_id: branchB.id,
  });
  const fresh = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', {
    delay_minutes: 30,
    revision: 2,
  });
  let reads = 0;
  api.GET.mockImplementation(() => {
    reads += 1;
    return Promise.resolve({ data: reads === 1 ? initial : fresh });
  });
  api.PUT.mockResolvedValue({
    error: {
      code: 'ALERT_RULE_REVISION_CONFLICT',
      message_ar: 'Synthetic save conflict',
      message_en: 'Synthetic save conflict',
    },
    response: { status: 409 },
  });
  const { client } = renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.change(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay'), { target: { value: '15' } });
  await act(async () => {
    await client.invalidateQueries({
      queryKey: alertRulesKey(companyId, userId, businessId, null),
    });
  });
  expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('15');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect((await screen.findByRole('alert')).textContent).toContain('Synthetic save conflict');
  await waitFor(() => expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('30'));
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect(await screen.findByText(t('en', 'alertRules.nothingChanged'))).toBeTruthy();
  expect(api.PUT).toHaveBeenCalledTimes(1);
});

it('replaces a reset kind after a conflict even when the refetch is identical', async () => {
  const initial = withAlertRule(
    { ...alertRulesFixture(), branch_id: branchA.id },
    'SHIFT_NOT_CLOCKED_IN',
    { source: 'BRANCH', delay_minutes: 20, revision: 1, rule_id: branchB.id },
  );
  const fresh = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', {
    delay_minutes: 12,
    revision: 2,
  });
  let branchReads = 0;
  api.GET.mockImplementation((path: string) => {
    if (path === businessPath) return Promise.resolve({ data: alertRulesFixture() });
    branchReads += 1;
    return Promise.resolve({ data: branchReads === 1 ? initial : fresh });
  });
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
  await waitFor(() => expect(minutesField('SHIFT_NOT_CLOCKED_IN', 'delay').value).toBe('12'));
  fireEvent.click(screen.getByRole('button', { name: resetName }));
  await waitFor(() => expect(api.DELETE).toHaveBeenCalledTimes(2));
  expect(api.DELETE.mock.calls[1]?.[1].params.query).toEqual({
    expected_rule_id: branchB.id,
    expected_revision: 2,
  });
});
