import { t } from '@pospay/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  alertRulesFixture,
  branchA,
  branchB,
  kindRow,
  kindSwitch,
  renderPage,
  withAlertRule,
} from './fixtures/alert-rules-page.fixture';

const api = vi.hoisted(() => ({ GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => api }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const businessPath = '/v1/businesses/{businessId}/alert-rules';
const branchPath = '/v1/businesses/{businessId}/branches/{branchId}/alert-rules';
const resetName = `${t('en', 'alertRules.resetToBusinessText')} — ${t('en', 'alertRules.kind_SHIFT_NOT_CLOCKED_IN')}`;

function branchView() {
  return withAlertRule(
    { ...alertRulesFixture(), branch_id: branchA.id },
    'SHIFT_NOT_CLOCKED_IN',
    { source: 'BRANCH', revision: 9, rule_id: branchB.id },
  );
}

beforeEach(() => {
  api.GET.mockReset();
  api.PUT.mockReset();
  api.DELETE.mockReset();
});

it('selects a branch and hides document expiry there', async () => {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve({ data: path === businessPath ? alertRulesFixture() : branchView() }),
  );
  renderPage({ branches: [branchA, branchB] });
  const selector = (await screen.findByLabelText(t('en', 'alertRules.scopeLabel'))) as HTMLSelectElement;
  expect(within(selector).getByRole('option', { name: t('en', 'alertRules.scopeBusiness') })).toBeTruthy();
  expect(within(selector).getByRole('option', { name: branchA.name_en })).toBeTruthy();
  expect(within(selector).getByRole('option', { name: branchB.name_en })).toBeTruthy();
  fireEvent.change(selector, { target: { value: branchA.id } });
  expect(await screen.findByText(t('en', 'alertRules.documentExpiryBranchNote'))).toBeTruthy();
  expect(api.GET).toHaveBeenCalledWith(branchPath, expect.objectContaining({
    params: expect.objectContaining({ path: { businessId: expect.any(String), branchId: branchA.id } }),
  }));
  expect(screen.queryByRole('switch', { name: t('en', 'alertRules.kind_DOCUMENT_EXPIRING') })).toBeNull();
  expect(screen.getByText(t('en', 'alertRules.documentExpiryBranchNote'))).toBeTruthy();
});

it('resets only a branch override and shows the business source afterwards', async () => {
  const initial = withAlertRule(branchView(), 'SERVICE_LINE_CANCELLED', { source: 'BUSINESS' });
  const returned = withAlertRule(initial, 'SHIFT_NOT_CLOCKED_IN', {
    source: 'BUSINESS', revision: null, rule_id: null,
  });
  let branchReads = 0;
  api.GET.mockImplementation((path: string) => {
    if (path === businessPath) return Promise.resolve({ data: alertRulesFixture() });
    branchReads += 1;
    return Promise.resolve({ data: branchReads === 1 ? initial : returned });
  });
  api.DELETE.mockResolvedValue({ data: undefined, response: { status: 204 } });
  renderPage({ branches: [branchA, branchB] });
  fireEvent.change(await screen.findByLabelText(t('en', 'alertRules.scopeLabel')), {
    target: { value: branchA.id },
  });
  expect(await screen.findByRole('button', { name: resetName })).toBeTruthy();
  expect(within(kindRow('SERVICE_LINE_CANCELLED')).queryByRole('button')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: resetName }));
  expect(await screen.findByText(t('en', 'alertRules.resetDone'))).toBeTruthy();
  expect(api.DELETE).toHaveBeenCalledWith(`${branchPath}/{kind}`, expect.objectContaining({
    params: expect.objectContaining({
      path: { businessId: expect.any(String), branchId: branchA.id, kind: 'SHIFT_NOT_CLOCKED_IN' },
      query: { expected_rule_id: branchB.id, expected_revision: 9 },
    }),
  }));
  await waitFor(() => expect(within(kindRow('SHIFT_NOT_CLOCKED_IN')).getByText('Business rule')).toBeTruthy());
  expect(screen.queryByRole('button', { name: resetName })).toBeNull();
});

it('saves branch changes to the branch path', async () => {
  api.GET.mockImplementation((path: string) =>
    Promise.resolve({ data: path === businessPath ? alertRulesFixture() : branchView() }),
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

it('hides the scope selector when there are no active branches', async () => {
  api.GET.mockResolvedValue({ data: alertRulesFixture() });
  renderPage();
  await screen.findByRole('switch', { name: t('en', 'alertRules.masterLabel') });
  expect(screen.queryByLabelText(t('en', 'alertRules.scopeLabel'))).toBeNull();
});
