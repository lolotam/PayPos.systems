import { t } from '@pospay/i18n';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  alertRulesFixture,
  branchA,
  branchB,
  minutesField,
  mockAlertRulesGet,
  renderPage,
  withAlertRule,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const businessPath = '/v1/businesses/{businessId}/alert-rules';
const KIND = 'SHIFT_NOT_CLOCKED_IN';
const serverError = {
  error: {
    code: 'INTERNAL',
    message_ar: 'Synthetic read failure',
    message_en: 'Synthetic read failure',
  },
  response: { status: 500 },
};
const conflict = {
  error: {
    code: 'ALERT_RULE_REVISION_CONFLICT',
    message_ar: 'Synthetic save conflict',
    message_en: 'Synthetic save conflict',
  },
  response: { status: 409 },
};

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('keeps the draft replacement after a save 409 whose recovery read fails and applies it on the retry', async () => {
  const initial = withAlertRule(alertRulesFixture(), KIND, {
    source: 'BUSINESS',
    delay_minutes: 20,
    revision: 1,
    rule_id: branchB.id,
  });
  const fresh = withAlertRule(initial, KIND, { delay_minutes: 30, revision: 2 });
  const answers = [{ data: initial }, serverError, { data: fresh }];
  let reads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet(() => Promise.resolve(answers[Math.min(reads++, answers.length - 1)])),
  );
  api.PUT.mockResolvedValueOnce(conflict).mockResolvedValueOnce({
    data: withAlertRule(fresh, KIND, { delay_minutes: 40, revision: 3 }),
  });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  fireEvent.change(minutesField(KIND, 'delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));

  expect((await screen.findAllByText('Synthetic read failure')).length).toBeGreaterThan(0);
  expect(minutesField(KIND, 'delay').value).toBe('15');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'pos.retry') }));

  await waitFor(() => expect(minutesField(KIND, 'delay').value).toBe('30'));
  fireEvent.change(minutesField(KIND, 'delay'), { target: { value: '40' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(2));
  const sent = api.PUT.mock.calls[1]?.[1].body.rules.find(
    (rule: { kind: string }) => rule.kind === KIND,
  );
  expect(sent).toMatchObject({ expected_revision: 2, expected_rule_id: branchB.id });
  expect(await screen.findByText(t('en', 'alertRules.saved'))).toBeTruthy();
});

it('keeps the reset replacement and notice after a successful reset whose recovery read fails', async () => {
  const initial = withAlertRule({ ...alertRulesFixture(), branch_id: branchA.id }, KIND, {
    source: 'BRANCH',
    delay_minutes: 20,
    revision: 1,
    rule_id: branchB.id,
  });
  const inherited = withAlertRule(initial, KIND, {
    source: 'BUSINESS',
    delay_minutes: 25,
    revision: null,
    rule_id: null,
  });
  const answers = [{ data: initial }, serverError, { data: inherited }];
  let reads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) =>
      path === businessPath
        ? Promise.resolve({ data: alertRulesFixture() })
        : Promise.resolve(answers[Math.min(reads++, answers.length - 1)]),
    ),
  );
  api.DELETE.mockResolvedValue({ response: { status: 204 } });
  renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  const resetName = `${t('en', 'alertRules.resetToBusinessText')} — ${t('en', 'alertRules.kind_SHIFT_NOT_CLOCKED_IN')}`;
  await screen.findByRole('button', { name: resetName });
  fireEvent.change(minutesField(KIND, 'delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: resetName }));

  expect((await screen.findAllByText('Synthetic read failure')).length).toBeGreaterThan(0);
  expect(minutesField(KIND, 'delay').value).toBe('15');
  expect(screen.queryByText(t('en', 'alertRules.resetDone'))).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: t('en', 'pos.retry') }));

  await waitFor(() => expect(minutesField(KIND, 'delay').value).toBe('25'));
  expect(await screen.findByText(t('en', 'alertRules.resetDone'))).toBeTruthy();
});

it('merges a reset conflict into the pending save replacement so both rows are replaced after the retry', async () => {
  const OTHER = 'SHIFT_BREAK_NOT_RETURNED';
  const branchRule = { source: 'BRANCH' as const, revision: 1, rule_id: branchB.id };
  const initial = withAlertRule(
    withAlertRule({ ...alertRulesFixture(), branch_id: branchA.id }, KIND, {
      ...branchRule,
      delay_minutes: 20,
    }),
    OTHER,
    { ...branchRule, delay_minutes: 10 },
  );
  const fresh = withAlertRule(
    withAlertRule(initial, KIND, { delay_minutes: 30, revision: 2 }),
    OTHER,
    { delay_minutes: 12, revision: 2 },
  );
  const answers = [{ data: initial }, serverError, serverError, { data: fresh }];
  let reads = 0;
  api.GET.mockImplementation(
    mockAlertRulesGet((path: string) =>
      path === businessPath
        ? Promise.resolve({ data: alertRulesFixture() })
        : Promise.resolve(answers[Math.min(reads++, answers.length - 1)]),
    ),
  );
  api.PUT.mockResolvedValueOnce(conflict).mockResolvedValueOnce({ data: fresh });
  api.DELETE.mockResolvedValueOnce(conflict);
  renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  const resetOther = `${t('en', 'alertRules.resetToBusinessText')} — ${t('en', 'alertRules.kind_SHIFT_BREAK_NOT_RETURNED')}`;
  await screen.findByRole('button', { name: resetOther });
  fireEvent.change(minutesField(KIND, 'delay'), { target: { value: '15' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  expect((await screen.findAllByText('Synthetic read failure')).length).toBeGreaterThan(0);
  expect(minutesField(KIND, 'delay').value).toBe('15');

  fireEvent.click(screen.getByRole('button', { name: resetOther }));
  await waitFor(() => expect(api.DELETE).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(reads).toBe(3));
  expect(minutesField(KIND, 'delay').value).toBe('15');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'pos.retry') }));

  await waitFor(() => expect(minutesField(KIND, 'delay').value).toBe('30'));
  expect(minutesField(OTHER, 'delay').value).toBe('12');
  fireEvent.change(minutesField(KIND, 'delay'), { target: { value: '40' } });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'alertRules.save') }));
  await waitFor(() => expect(api.PUT).toHaveBeenCalledTimes(2));
  const rules = api.PUT.mock.calls[1]?.[1].body.rules as {
    kind: string;
    expected_revision: number | null;
    expected_rule_id: string | null;
  }[];
  expect(rules.find((rule) => rule.kind === KIND)).toMatchObject({
    expected_revision: 2,
    expected_rule_id: branchB.id,
  });
});
