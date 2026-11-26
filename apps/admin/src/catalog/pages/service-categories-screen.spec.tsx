import type { ReactNode } from 'react';
import type { ServiceCategoryBranchView, ServiceCategoryListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  branch,
  branchCategory,
  branchId,
  business,
  businessId,
  companyId,
  secondBranch,
  userId,
} from './service-categories-screen.fixtures';
import { ServiceCategoriesScreen } from './service-categories-screen';

const get = vi.hoisted(() => vi.fn());
const localeState = vi.hoisted(() => ({ selected: 'en' as Locale }));
vi.mock('@/shared/api/client', () => ({ apiClient: () => ({ GET: get }) }));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => localeState.selected }));

const businessListPath = '/v1/businesses/{businessId}/service-categories';
const branchListPath = '/v1/businesses/{businessId}/branches/{branchId}/service-categories';

function okPage(items: unknown[]) {
  return { data: { items, next_cursor: null }, response: { status: 200 } };
}

function refusal(status: number) {
  return {
    error: {
      code: 'FORBIDDEN',
      message_ar: 'Forbidden AR',
      message_en: 'Forbidden for the branch',
    },
    response: { status },
  };
}

function mockBranchList(items: (view: ServiceCategoryBranchView) => unknown[]) {
  get.mockImplementation((path: string, options?: { params?: { query?: { view?: string } } }) => {
    if (path === branchListPath) {
      return Promise.resolve(
        okPage(items((options?.params?.query?.view ?? 'in_use') as ServiceCategoryBranchView)),
      );
    }
    return Promise.resolve(refusal(500));
  });
}

function renderScreen(
  props: Partial<{
    companyScope: 'COMPANY' | 'BUSINESS' | 'BRANCH';
    rememberedBranchId: string | undefined;
    business: ReturnType<typeof business>;
  }> = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ServiceCategoriesScreen
      companyId={companyId}
      business={business([branch(), secondBranch()])}
      userId={userId}
      companyScope="BRANCH"
      rememberedBranchId={undefined}
      {...props}
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <div dir={localeState.selected === 'ar' ? 'rtl' : 'ltr'}>{children}</div>
        </QueryClientProvider>
      ),
    },
  );
}

beforeEach(() => {
  get.mockReset();
  localeState.selected = 'en';
});

it.each(['en', 'ar'] as const)(
  'opens a branch-scoped user on their branch without offering the whole business in %s',
  async (locale) => {
    localeState.selected = locale;
    const name = locale === 'ar' ? 'Bridal AR' : 'Bridal';
    mockBranchList((view) =>
      view === 'in_use' ? [branchCategory({ name_en: 'Bridal', name_ar: 'Bridal AR' })] : [],
    );
    renderScreen();
    const row = await screen.findByRole('row', { name: new RegExp(name) });
    expect(row.closest('[dir]')?.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    const select = screen.getByRole('combobox', {
      name: t(locale, 'catalogServiceCategoryBranches.scopeLabel'),
    }) as HTMLSelectElement;
    expect(select.selectedOptions[0]?.textContent).toBe(
      locale === 'ar' ? 'First branch AR' : 'First branch',
    );
    expect(
      screen.queryByRole('option', {
        name: t(locale, 'catalogServiceCategoryBranches.scopeBusiness'),
      }),
    ).toBeNull();
    expect(get.mock.calls.some(([path]) => path === businessListPath)).toBe(false);
  },
);

it('opens a business reached only through a branch on that branch, without offering the whole business', async () => {
  mockBranchList(() => [branchCategory({ name_en: 'Branch row' })]);
  renderScreen({
    companyScope: 'BUSINESS',
    business: business([branch(), secondBranch()], 'BRANCH'),
  });
  const select = screen.getByRole('combobox', {
    name: t('en', 'catalogServiceCategoryBranches.scopeLabel'),
  }) as HTMLSelectElement;
  expect(select.selectedOptions[0]?.textContent).toBe('First branch');
  expect(
    screen.queryByRole('option', {
      name: t('en', 'catalogServiceCategoryBranches.scopeBusiness'),
    }),
  ).toBeNull();
  expect(await screen.findByRole('row', { name: /Branch row/ })).toBeTruthy();
  expect(get.mock.calls.some(([path]) => path === businessListPath)).toBe(false);
});

it('opens a business-scoped user on the whole business and switches to a branch', async () => {
  get.mockImplementation((path: string, options?: { params?: { query?: { view?: string } } }) => {
    if (path === businessListPath)
      return Promise.resolve(
        okPage([
          {
            id: '01920000-0000-7000-8000-0000000000c4',
            name_en: 'Business row',
            name_ar: 'Business row AR',
            visibility: 'BUSINESS',
            owner_branch_id: null,
            closed_at: null,
            revision: 1,
          },
        ]),
      );
    if (path === branchListPath) {
      return Promise.resolve(
        okPage(
          options?.params?.query?.view === 'available'
            ? []
            : [branchCategory({ name_en: 'Branch row', name_ar: 'Branch row AR' })],
        ),
      );
    }
    return Promise.resolve(refusal(500));
  });
  renderScreen({ companyScope: 'BUSINESS' });
  expect(await screen.findByRole('row', { name: /Business row/ })).toBeTruthy();
  expect(
    screen.getByRole('option', {
      name: t('en', 'catalogServiceCategoryBranches.scopeBusiness'),
    }),
  ).toBeTruthy();
  fireEvent.change(
    screen.getByRole('combobox', { name: t('en', 'catalogServiceCategoryBranches.scopeLabel') }),
    { target: { value: branchId } },
  );
  expect(await screen.findByRole('row', { name: /Branch row/ })).toBeTruthy();
  expect(screen.queryByRole('row', { name: /Business row/ })).toBeNull();
});

it('shows the available rows with the other branch and hidden marks', async () => {
  mockBranchList((view) =>
    view === 'available'
      ? [
          branchCategory({
            id: '01920000-0000-7000-8000-0000000000c2',
            name_en: 'Spa',
            visibility: 'BRANCH',
            owner_branch_id: secondBranch().id,
          }),
          branchCategory({
            id: '01920000-0000-7000-8000-0000000000c3',
            name_en: 'Massage',
            setting_state: 'HIDDEN',
          }),
        ]
      : [branchCategory({ name_en: 'Used in the branch' })],
  );
  renderScreen();
  fireEvent.click(
    await screen.findByRole('button', {
      name: t('en', 'catalogServiceCategoryBranches.tabAvailable'),
    }),
  );
  const foreignRow = await screen.findByRole('row', { name: /Spa/ });
  expect(
    within(foreignRow).getByText(t('en', 'catalogServiceCategories.visibilityBranch')),
  ).toBeTruthy();
  const hiddenRow = screen.getByRole('row', { name: /Massage/ });
  expect(
    within(hiddenRow).getByText(t('en', 'catalogServiceCategoryBranches.hiddenHere')),
  ).toBeTruthy();
  expect(screen.queryByRole('row', { name: /Used in the branch/ })).toBeNull();
});

it('marks a private category owned by the branch as its own', async () => {
  mockBranchList(() => [
    branchCategory({ name_en: 'Own private', visibility: 'BRANCH', owner_branch_id: branchId }),
  ]);
  renderScreen();
  const row = await screen.findByRole('row', { name: /Own private/ });
  expect(within(row).getByText(t('en', 'catalogServiceCategoryBranches.ownedHere'))).toBeTruthy();
});

it('shows the refusal message when the branch list answers 403', async () => {
  get.mockResolvedValue(refusal(403));
  renderScreen();
  expect(await screen.findByText('Forbidden for the branch')).toBeTruthy();
});

it('shows the empty line when the branch has no categories in the view', async () => {
  mockBranchList(() => []);
  renderScreen();
  expect(await screen.findByText(t('en', 'catalogServiceCategories.empty'))).toBeTruthy();
});

const businessRow = (overrides: Partial<ServiceCategoryListItem>): ServiceCategoryListItem => ({
  id: '01920000-0000-7000-8000-0000000000c4',
  name_en: 'Business row',
  name_ar: 'Business row AR',
  visibility: 'BUSINESS',
  owner_branch_id: null,
  closed_at: null,
  revision: 1,
  ...overrides,
});

it('keeps the business page state across a branch round-trip', async () => {
  get.mockImplementation((path: string, options?: { params?: { query?: { status?: string } } }) => {
    if (path === businessListPath) {
      const closed = (options?.params?.query?.status ?? 'open') === 'closed';
      return Promise.resolve(
        okPage([
          businessRow(
            closed
              ? { name_en: 'Closed row', closed_at: '2026-01-01T00:00:00Z' }
              : { name_en: 'Open row' },
          ),
        ]),
      );
    }
    if (path === branchListPath) return Promise.resolve(okPage([]));
    return Promise.resolve(refusal(500));
  });
  renderScreen({ companyScope: 'BUSINESS' });
  expect(await screen.findByRole('row', { name: /Open row/ })).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.tabClosed') }),
  );
  expect(await screen.findByRole('row', { name: /Closed row/ })).toBeTruthy();
  const select = screen.getByRole('combobox', {
    name: t('en', 'catalogServiceCategoryBranches.scopeLabel'),
  });
  fireEvent.change(select, { target: { value: branchId } });
  expect(await screen.findByText(t('en', 'catalogServiceCategories.empty'))).toBeTruthy();
  fireEvent.change(select, { target: { value: '' } });
  const closedTab = screen.getByRole('button', {
    name: t('en', 'catalogServiceCategories.tabClosed'),
  });
  expect(closedTab.getAttribute('aria-pressed')).toBe('true');
  expect(await screen.findByRole('row', { name: /Closed row/ })).toBeTruthy();
  expect(screen.queryByRole('row', { name: /Open row/ })).toBeNull();
});

it('opens on the remembered branch when it is an active branch', async () => {
  mockBranchList(() => [branchCategory({ name_en: 'Second branch row' })]);
  renderScreen({ companyScope: 'BRANCH', rememberedBranchId: secondBranch().id });
  const select = screen.getByRole('combobox', {
    name: t('en', 'catalogServiceCategoryBranches.scopeLabel'),
  }) as HTMLSelectElement;
  expect(select.value).toBe(secondBranch().id);
  expect(select.selectedOptions[0]?.textContent).toBe('Second branch');
  expect(await screen.findByRole('row', { name: /Second branch row/ })).toBeTruthy();
  const calls = get.mock.calls.filter(([path]) => path === branchListPath);
  expect(calls.at(-1)?.[1]?.params?.path).toEqual({ businessId, branchId: secondBranch().id });
});

it('falls back to the first active branch when the remembered branch is unknown', async () => {
  mockBranchList(() => []);
  renderScreen({
    companyScope: 'BRANCH',
    rememberedBranchId: '01920000-0000-7000-8000-0000000000ff',
    business: business([branch({ is_active: false }), secondBranch()]),
  });
  const select = screen.getByRole('combobox', {
    name: t('en', 'catalogServiceCategoryBranches.scopeLabel'),
  }) as HTMLSelectElement;
  expect(select.selectedOptions[0]?.textContent).toBe('Second branch');
  expect(screen.queryByRole('option', { name: 'First branch' })).toBeNull();
});

it('shows a no-active-branch empty state without reading the business list', async () => {
  get.mockImplementation(() => Promise.resolve(refusal(403)));
  renderScreen({ companyScope: 'BRANCH', business: business([branch({ is_active: false })]) });
  expect(
    await screen.findByText(t('en', 'catalogServiceCategoryBranches.noActiveBranch')),
  ).toBeTruthy();
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(get.mock.calls.some(([path]) => path === businessListPath)).toBe(false);
});
