import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deferredAnswer,
  EMP_A,
  employeeItem,
  employeePage,
  employeesPath,
  ok,
  refusal,
} from '@/commissions/api/__tests__/plan-http';
import { planProbeKey, planScope } from '@/commissions/api/plan-access';
import { leaveId } from '@/staff/api/leave-decision.fixture';
import { historyPage } from '@/staff/api/leave-history.fixture';
import { envelopeFailure, requiredRefusal } from '@/staff/api/leave-report.fixture';

import { carriedApi, carriedState, readyWorkspace, REF } from './carried-mocks';
import {
  expectHiddenOnceSettled,
  expectListed,
  isListed,
  newClient,
  readParams,
  refusalAnswer,
  renderVisible,
} from './carried-reads-support';

vi.mock('@/shared/api/client', async () => (await import('./carried-mocks')).apiClientMock);
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));
vi.mock('@/shared/browser/use-mounted', () => ({ useMounted: () => true }));
vi.mock('@/session/api/use-session', async () => (await import('./carried-mocks')).sessionUserMock);
vi.mock(
  '@/workspace/model/workspace-provider',
  async () => (await import('./carried-mocks')).workspaceReadMock,
);

// المدخلان يتشاركان قراءة واحدة؛ بقية القراءات خلف شروط الظهور لها مساراتها، فنعدّ طلبات القائمة وحدها.
const probeCalls = () => carriedApi.GET.mock.calls.filter(([path]) => path === employeesPath);
const never = () => new Promise(() => undefined);
const RATING_PATH = '/v1/businesses/{businessId}/rating-settings';

beforeEach(() => {
  carriedApi.GET.mockReset();
  carriedState.userId = 'user';
  carriedState.workspace = readyWorkspace();
});

describe('alerts and notifications (was alert-rules-nav-item.spec)', () => {
  const ID = { label: 'alertRules.title', href: '/alert-rules' } as const;
  const rules = { business_id: REF, branch_id: null, alerts_enabled: true, rules: [] };

  it('is hidden while the business rules read is pending', () => {
    carriedApi.GET.mockReturnValue(new Promise(() => undefined));
    renderVisible();
    expect(isListed(ID)).toBe(false);
  });

  it.each([500, 403])('is hidden when the business read answers %i', async (status) => {
    carriedApi.GET.mockResolvedValue(refusalAnswer(status));
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, ID);
  });

  it('is shown after a successful business read, reading the selected business', async () => {
    carriedApi.GET.mockImplementation((path: string) =>
      Promise.resolve(path === RATING_PATH ? { data: { requests_enabled: true } } : { data: rules }),
    );
    renderVisible();
    await expectListed(ID);
    expect(carriedApi.GET).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/alert-rules',
      readParams(),
    );
  });

  it('is shown when only the rating settings read succeeds', async () => {
    carriedApi.GET.mockImplementation((path: string) =>
      Promise.resolve(path === RATING_PATH ? { data: { requests_enabled: true } } : refusalAnswer(403)),
    );
    renderVisible();
    await expectListed(ID);
  });
});

describe('business identity (was business-identity-nav-item.spec)', () => {
  const ID = { label: 'businessIdentity.title', href: '/business-identity' } as const;
  const PATH = '/v1/businesses/{businessId}/settings/identity-capability';

  it('is hidden when the capability read says the caller cannot manage identity', async () => {
    carriedApi.GET.mockResolvedValue({ data: { can_manage_identity: false }, response: { status: 200 } });
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, ID);
  });

  it('is hidden while the capability read is loading', () => {
    carriedApi.GET.mockReturnValue(new Promise(() => undefined));
    renderVisible();
    expect(isListed(ID)).toBe(false);
  });

  it('is hidden when the capability read failed', async () => {
    carriedApi.GET.mockResolvedValue({ error: { code: 'UNEXPECTED' }, response: { status: 500 } });
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, ID);
  });

  it('is shown when the capability read allows identity management', async () => {
    carriedApi.GET.mockResolvedValue({ data: { can_manage_identity: true }, response: { status: 200 } });
    renderVisible();
    await expectListed(ID);
    expect(carriedApi.GET).toHaveBeenCalledWith(PATH, readParams());
  });

  it('is not shown, and nothing is read, before a business is selected', () => {
    carriedState.workspace = readyWorkspace(false);
    renderVisible();
    expect(isListed(ID)).toBe(false);
    expect(carriedApi.GET).not.toHaveBeenCalled();
  });
});

describe('commission plans and overrides (was commission-plans-nav-item.spec)', () => {
  const PLANS = { label: 'commissionPlanBuilder.navTitle', href: '/commissions/plans' } as const;
  const OVERRIDES = {
    label: 'commissionOverrides.navTitle',
    href: '/commissions/overrides',
  } as const;

  it('hides both entries while the first employees page is pending', () => {
    carriedApi.GET.mockReturnValue(new Promise(() => undefined));
    renderVisible();
    expect(isListed(PLANS)).toBe(false);
    expect(isListed(OVERRIDES)).toBe(false);
  });

  it('hides both entries when the first employees page answers 403, after one request', async () => {
    carriedApi.GET.mockResolvedValue(refusal(403, 'FORBIDDEN'));
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, PLANS);
    expect(isListed(OVERRIDES)).toBe(false);
    expect(probeCalls()).toHaveLength(1);
  });

  it('shows both entries after one successful probe request', async () => {
    const pending = deferredAnswer();
    carriedApi.GET.mockImplementation(() => pending.promise);
    const { client } = renderVisible();
    pending.resolve(ok(employeePage([employeeItem(EMP_A, 7, null, 'Sara')], null)));
    await expectListed(PLANS);
    await expectListed(OVERRIDES);
    expect(probeCalls()).toHaveLength(1);
    // فحص القوائم بيبعت سطر واحد بس: هو بيكفي لإظهار المدخل ومش بيقرا الشاشة كلها.
    expect(carriedApi.GET).toHaveBeenCalledWith(
      employeesPath,
      expect.objectContaining({
        params: expect.objectContaining({
          header: { 'x-company-id': REF },
          path: { businessId: REF },
          query: { limit: 1 },
        }),
      }),
    );
    // تأكيد أن جواب الموظفين اتخزن تحت مفتاح فحص القائمة بتاع نفس الهوية.
    const userId = carriedState.userId;
    if (userId === null) throw new Error('the carried mocks run with a signed-in user');
    expect(client.getQueryData(planProbeKey(planScope(REF, REF, userId)))).toBeDefined();
  });

  it('shows neither entry for an admin without a chosen business', () => {
    carriedState.workspace = readyWorkspace(false);
    renderVisible();
    expect(isListed(PLANS)).toBe(false);
    expect(isListed(OVERRIDES)).toBe(false);
  });
});

describe('staff app link (was employee-app-link-nav-item.spec)', () => {
  const ID = { label: 'employeeAppLink.title', href: '/staff/employee-app-link' } as const;

  it('is shown when the guarded read succeeds', async () => {
    carriedApi.GET.mockResolvedValue({
      data: {
        company_id: REF,
        business_id: REF,
        business_name_en: 'Synthetic business',
        business_name_ar: null,
      },
      response: { status: 200 },
    });
    renderVisible();
    await expectListed(ID);
  });

  it.each([403, 500])('is hidden when the read fails with %s', async (status) => {
    carriedApi.GET.mockResolvedValue({ error: { code: 'REFUSED' }, response: { status } });
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, ID);
  });
});

describe('imported refunds (was imported-refunds-nav-item.spec)', () => {
  const ID = { label: 'importedRefunds.title', href: '/imported-refunds' } as const;
  const PATH = '/v1/businesses/{businessId}/settings/imported-refunds';

  it('is hidden while the guarded read is pending', () => {
    carriedApi.GET.mockReturnValue(new Promise(() => undefined));
    renderVisible();
    expect(isListed(ID)).toBe(false);
  });

  it('is hidden after a 403 refusal', async () => {
    carriedApi.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, ID);
  });

  it('is shown when the guarded read succeeds, reading the selected business', async () => {
    carriedApi.GET.mockResolvedValue({
      data: { imported_refunds_enabled: false },
      response: { status: 200 },
    });
    renderVisible();
    await expectListed(ID);
    expect(carriedApi.GET).toHaveBeenCalledWith(PATH, readParams());
  });

  it('is not read or shown before a business is selected', () => {
    carriedState.workspace = readyWorkspace(false);
    renderVisible();
    expect(isListed(ID)).toBe(false);
    expect(carriedApi.GET).not.toHaveBeenCalled();
  });

});

describe('imported refunds, after a business switch or a refetch', () => {
  const ID = { label: 'importedRefunds.title', href: '/imported-refunds' } as const;
  const PATH = '/v1/businesses/{businessId}/settings/imported-refunds';

  it('is hidden on switching to a previously cached business until its own read authorizes it', async () => {
    const other = '01920000-0000-7000-8000-0000000000b2';
    const client = newClient();
    client.setQueryData(['imported-refunds', REF, 'user', other], { imported_refunds_enabled: true });
    const answerFor = (enabled: boolean) => (path: string) =>
      path === PATH
        ? Promise.resolve({ data: { imported_refunds_enabled: enabled }, response: { status: 200 } })
        : never();
    carriedApi.GET.mockImplementation(answerFor(false));
    const view = renderVisible(client);
    await expectListed(ID);
    const current = carriedState.workspace;
    if (current?.status !== 'ready' || !current.business) throw new Error('missing workspace');
    carriedState.workspace = { ...current, business: { ...current.business, id: other } };
    carriedApi.GET.mockImplementation(never);
    view.rerenderVisible();
    expect(isListed(ID)).toBe(false);
    carriedApi.GET.mockImplementation(answerFor(true));
    await client.invalidateQueries({ queryKey: ['imported-refunds', REF, 'user', other] });
    await expectListed(ID);
  });

  it('drops the visible entry after a guarded refetch refuses access', async () => {
    const client = newClient();
    carriedApi.GET.mockResolvedValue({
      data: { imported_refunds_enabled: true },
      response: { status: 200 },
    });
    renderVisible(client);
    await expectListed(ID);
    carriedApi.GET.mockResolvedValue({ error: { code: 'FORBIDDEN' }, response: { status: 403 } });
    await client.invalidateQueries({ queryKey: ['imported-refunds', REF, 'user', REF] });
    await waitFor(() => expect(isListed(ID)).toBe(false));
  });
});

describe('leave history report (was leave-report-nav-item.spec)', () => {
  const ID = { label: 'leaveHistory.reportTitle', href: '/staff/leave-history' } as const;

  beforeEach(() => {
    carriedState.workspace = readyWorkspace(true, leaveId);
  });

  it('is shown when the probe read succeeds', async () => {
    carriedApi.GET.mockResolvedValue({ data: historyPage() });
    renderVisible();
    await expectListed(ID);
  });

  it('is shown when the heavy report refusal answers the probe', async () => {
    carriedApi.GET.mockResolvedValue(requiredRefusal());
    renderVisible();
    await expectListed(ID);
  });

  it('is hidden when the probe answers 404', async () => {
    carriedApi.GET.mockResolvedValue(envelopeFailure(404, 'NOT_FOUND'));
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, ID);
  });

  it('is not read or shown when the workspace has no business', () => {
    carriedState.workspace = readyWorkspace(false);
    renderVisible();
    expect(carriedApi.GET).not.toHaveBeenCalled();
    expect(isListed(ID)).toBe(false);
  });
});

describe('staff app columns (was staff-app-columns-nav-item.spec)', () => {
  const ID = { label: 'staffAppColumns.title', href: '/staff-app-columns' } as const;
  const settings = {
    business_id: REF,
    columns: ['date', 'time'],
    columns_default: true,
    months_back: 2,
    months_back_default: true,
  };

  it('is hidden while the columns read is still running', () => {
    carriedApi.GET.mockReturnValue(new Promise(() => undefined));
    renderVisible();
    expect(isListed(ID)).toBe(false);
  });

  it.each([500, 403])('is hidden when the columns read answers %i', async (status) => {
    carriedApi.GET.mockResolvedValue(refusalAnswer(status));
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, ID);
  });

  it('is shown and reads the columns of the selected business', async () => {
    carriedApi.GET.mockResolvedValue({ data: settings });
    renderVisible();
    await expectListed(ID);
    expect(carriedApi.GET).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/settings/staff-columns',
      readParams(),
    );
    expect(screen.getByRole('list', { name: 'Visible pages' })).toBeTruthy();
  });
});

describe('ratings and reviews (was ratings-nav-item.spec, added by #1228)', () => {
  const ID = { label: 'ratings.title', href: '/ratings' } as const;
  const listAnswer = { data: { items: [], next_cursor: null }, response: { status: 200 } };
  const readsOneRatingsRow = () =>
    carriedApi.GET.mock.calls.some(
      ([, options]) => JSON.stringify(options?.params?.query) === JSON.stringify({ limit: 1 }),
    );

  it('shows the link to the ratings page once the list read succeeds, reading one row', async () => {
    carriedApi.GET.mockResolvedValue(listAnswer);
    renderVisible();
    await expectListed(ID);
    expect(readsOneRatingsRow()).toBe(true);
  });

  it('keeps the link hidden while the read is pending', () => {
    carriedApi.GET.mockReturnValue(new Promise(() => undefined));
    renderVisible();
    expect(isListed(ID)).toBe(false);
  });

  it.each([403, 500])('hides the link when the list answers %i', async (status) => {
    carriedApi.GET.mockResolvedValue(refusalAnswer(status));
    const { client } = renderVisible();
    await expectHiddenOnceSettled(client, ID);
  });
});

