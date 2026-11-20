import type { ReactNode } from 'react';
import { t, type MessageKey } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import {
  branchCategory,
  branchId,
  businessId,
  companyId,
  envelope,
  okPage,
  otherBranchId,
  userId,
} from './branch-service-categories-actions.fixtures';
import { BranchServiceCategoriesSection } from './branch-service-categories-section';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const localeState = vi.hoisted(() => ({ selected: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post, PATCH: patch, PUT: put }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => localeState.selected }));

const branchListPath = '/v1/businesses/{businessId}/branches/{branchId}/service-categories';
const statePath = `${branchListPath}/{categoryId}/state`;
const patchPath = `${branchListPath}/{categoryId}`;

let inUse: unknown[];
let available: unknown[];

function mockBranchLists() {
  get.mockImplementation((path: string, options?: { params?: { query?: { view?: string } } }) => {
    if (path === branchListPath) {
      const view = options?.params?.query?.view ?? 'in_use';
      return Promise.resolve(okPage(view === 'in_use' ? inUse : available));
    }
    return Promise.resolve(envelope(500, 'UNKNOWN', 'Unexpected route'));
  });
}

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <BranchServiceCategoriesSection {...{ companyId, businessId, userId, branchId }} />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>
          <div dir={localeState.selected === 'ar' ? 'rtl' : 'ltr'}>{children}</div>
        </QueryClientProvider>
      ),
    },
  );
}

async function openTab(
  tabKey: 'catalogServiceCategoryBranches.tabInUse' | 'catalogServiceCategoryBranches.tabAvailable',
) {
  const tab = screen.getByRole('button', { name: t('en', tabKey) });
  if (tab.getAttribute('aria-pressed') !== 'true') fireEvent.click(tab);
}

function openCreateForm() {
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.create') }));
}

function submitCreate() {
  const form = screen.getByRole('form', {
    name: t('en', 'catalogServiceCategories.createTitle'),
  });
  fireEvent.click(
    within(form).getByRole('button', { name: t('en', 'catalogServiceCategories.create') }),
  );
}

function fillCreateForm(nameEn: string, nameAr: string, radioKey: MessageKey) {
  fireEvent.change(screen.getByLabelText(t('en', 'catalogServiceCategories.nameEn')), {
    target: { value: nameEn },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'catalogServiceCategories.nameAr')), {
    target: { value: nameAr },
  });
  fireEvent.click(screen.getByRole('radio', { name: t('en', radioKey) }));
}

async function clickSeenButton(nameKey: MessageKey) {
  fireEvent.click(await screen.findByRole('button', { name: t('en', nameKey) }));
}

function clickButton(nameKey: MessageKey) {
  fireEvent.click(screen.getByRole('button', { name: t('en', nameKey) }));
}

function typeInto(labelKey: MessageKey, value: string) {
  fireEvent.change(screen.getByLabelText(t('en', labelKey)), { target: { value } });
}

function inputOf(labelKey: MessageKey) {
  return screen.getByLabelText(t('en', labelKey)) as HTMLInputElement;
}

function ownPrivateRow(nameEn: string, nameAr: string, revision: number) {
  return branchCategory({
    visibility: 'BRANCH',
    owner_branch_id: branchId,
    name_en: nameEn,
    name_ar: nameAr,
    revision,
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  put.mockReset();
  localeState.selected = 'en';
  inUse = [];
  available = [];
});

it('offers a branch manager only the state actions on a shared category', async () => {
  inUse = [branchCategory()];
  mockBranchLists();
  renderSection();
  const row = await screen.findByRole('row', { name: /Hair/ });
  expect(
    within(row).getByRole('button', {
      name: t('en', 'catalogServiceCategoryBranches.hide'),
    }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: t('en', 'catalogServiceCategories.manage') }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: t('en', 'catalogServiceCategoryBranches.share'),
    }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', {
      name: t('en', 'catalogServiceCategories.closeCategory'),
    }),
  ).toBeNull();
  expect(screen.queryByText(t('en', 'catalogServiceCategories.editTitle'))).toBeNull();
});

it('hides an in-use row without settings revision and follows it to the available tab', async () => {
  inUse = [branchCategory({ setting_state: null, setting_revision: null })];
  put.mockImplementation(async () => {
    inUse = [];
    available = [branchCategory({ setting_state: 'HIDDEN', setting_revision: 1 })];
    return {
      data: branchCategory({ setting_state: 'HIDDEN', setting_revision: 1 }),
      response: { status: 200 },
    };
  });
  mockBranchLists();
  renderSection();
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategoryBranches.hide') }),
  );
  expect(await screen.findByText(/Hidden from this branch\./)).toBeTruthy();
  expect(put.mock.calls[0]?.[0]).toBe(statePath);
  expect(put.mock.calls[0]?.[1]?.body).toEqual({ state: 'HIDDEN', expected_revision: null });
  await openTab('catalogServiceCategoryBranches.tabAvailable');
  const row = await screen.findByRole('row', { name: /Hair/ });
  expect(within(row).getByText(t('en', 'catalogServiceCategoryBranches.hiddenHere'))).toBeTruthy();
});

it('enables another branch private category and moves it to the in-use tab', async () => {
  available = [branchCategory({ visibility: 'BRANCH', owner_branch_id: otherBranchId })];
  put.mockImplementation(async () => {
    available = [];
    inUse = [branchCategory({ visibility: 'BRANCH', owner_branch_id: otherBranchId })];
    return {
      data: branchCategory({ visibility: 'BRANCH', owner_branch_id: otherBranchId }),
      response: { status: 200 },
    };
  });
  mockBranchLists();
  renderSection();
  await openTab('catalogServiceCategoryBranches.tabAvailable');
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategoryBranches.enable') }),
  );
  expect(await screen.findByText(/Enabled in this branch\./)).toBeTruthy();
  expect(put.mock.calls[0]?.[1]?.body).toEqual({ state: 'ENABLED', expected_revision: 1 });
  await openTab('catalogServiceCategoryBranches.tabInUse');
  expect(await screen.findByRole('row', { name: /Hair/ })).toBeTruthy();
});

it('keeps the refusal line of a refused enable after the refetch removes the row', async () => {
  available = [branchCategory({ visibility: 'BRANCH', owner_branch_id: otherBranchId })];
  put.mockImplementation(async () => {
    available = [];
    return envelope(409, 'SERVICE_CATEGORY_CLOSED', 'This category is closed.');
  });
  mockBranchLists();
  renderSection();
  await openTab('catalogServiceCategoryBranches.tabAvailable');
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategoryBranches.enable') }),
  );
  expect(await screen.findByText(/This category is closed\./)).toBeTruthy();
  await screen.findByText(t('en', 'catalogServiceCategories.empty'));
  expect(screen.queryByRole('row', { name: /Hair/ })).toBeNull();
  expect(screen.getByText(/This category is closed\./)).toBeTruthy();
});

it('re-seeds the rename form after a revision conflict reload and posts the new revision', async () => {
  inUse = [ownPrivateRow('Old En', 'Old AR', 3)];
  patch.mockResolvedValue(
    envelope(409, 'SERVICE_CATEGORY_REVISION_CONFLICT', 'Another manager changed it.'),
  );
  mockBranchLists();
  renderSection();
  await clickSeenButton('catalogServiceCategories.manage');
  typeInto('catalogServiceCategories.nameEn', 'Local En');
  clickButton('catalogServiceCategories.save');
  expect(await screen.findByText(/Another manager changed it\./)).toBeTruthy();
  inUse = [ownPrivateRow('Server En', 'Server AR', 5)];
  patch.mockResolvedValue({
    data: ownPrivateRow('Server En', 'Server AR', 5),
    response: { status: 200 },
  });
  clickButton('catalogServiceCategories.reload');
  await vi.waitFor(() => {
    expect(inputOf('catalogServiceCategories.nameEn').value).toBe('Server En');
  });
  expect(inputOf('catalogServiceCategories.nameAr').value).toBe('Server AR');
  clickButton('catalogServiceCategories.save');
  await vi.waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
  expect(patch.mock.calls[1]?.[1]?.body).toMatchObject({
    name_en: 'Server En',
    name_ar: 'Server AR',
    expected_revision: 5,
  });
  expect(patch.mock.calls[1]?.[1]?.body).not.toHaveProperty('visibility');
});

it('creates a private category with the branch choice and shows it as its own', async () => {
  post.mockImplementation(async () => {
    inUse = [
      branchCategory({
        id: '01920000-0000-7000-8000-0000000000d1',
        name_en: 'Spa',
        name_ar: 'Spa AR',
        visibility: 'BRANCH',
        owner_branch_id: branchId,
      }),
    ];
    return {
      data: branchCategory({
        id: '01920000-0000-7000-8000-0000000000d1',
        name_en: 'Spa',
        name_ar: 'Spa AR',
        visibility: 'BRANCH',
        owner_branch_id: branchId,
      }),
      response: { status: 201 },
    };
  });
  mockBranchLists();
  renderSection();
  await screen.findByText(t('en', 'catalogServiceCategories.empty'));
  openCreateForm();
  fillCreateForm('Spa', 'Spa AR', 'catalogServiceCategoryBranches.visibilityPrivate');
  submitCreate();
  const row = await screen.findByRole('row', { name: /Spa/ });
  expect(within(row).getByText(t('en', 'catalogServiceCategoryBranches.ownedHere'))).toBeTruthy();
  expect(post.mock.calls[0]?.[0]).toBe(branchListPath);
  expect(post.mock.calls[0]?.[1]?.body).toEqual({
    name_en: 'Spa',
    name_ar: 'Spa AR',
    visibility: 'BRANCH',
  });
});

it('jumps to the available tab from the taken-name refusal', async () => {
  available = [
    branchCategory({
      id: '01920000-0000-7000-8000-0000000000e1',
      name_en: 'Existing',
      name_ar: 'Existing AR',
    }),
  ];
  post.mockResolvedValue(envelope(409, 'SERVICE_CATEGORY_NAME_TAKEN', 'This name is taken.'));
  mockBranchLists();
  renderSection();
  await screen.findByText(t('en', 'catalogServiceCategories.empty'));
  openCreateForm();
  fillCreateForm('Hair', 'Hair AR', 'catalogServiceCategoryBranches.visibilityPrivate');
  submitCreate();
  expect(await screen.findByText(/This name is taken\./)).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategoryBranches.seeAvailable') }),
  );
  const availableTab = screen.getByRole('button', {
    name: t('en', 'catalogServiceCategoryBranches.tabAvailable'),
  });
  expect(availableTab.getAttribute('aria-pressed')).toBe('true');
  expect(await screen.findByRole('row', { name: /Existing/ })).toBeTruthy();
});

it('shares an own private category after the one-way warning and stops offering rename', async () => {
  inUse = [branchCategory({ visibility: 'BRANCH', owner_branch_id: branchId, revision: 2 })];
  patch.mockImplementation(async () => {
    inUse = [branchCategory({ visibility: 'BUSINESS', owner_branch_id: branchId, revision: 3 })];
    return {
      data: branchCategory({ visibility: 'BUSINESS', owner_branch_id: branchId, revision: 3 }),
      response: { status: 200 },
    };
  });
  mockBranchLists();
  renderSection();
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategories.manage') }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategoryBranches.share') }),
  );
  expect(screen.getByText(t('en', 'catalogServiceCategoryBranches.shareConfirm'))).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }),
  );
  const row = await screen.findByRole('row', { name: /Hair/ });
  expect(
    within(row).getByText(t('en', 'catalogServiceCategories.visibilityBusiness')),
  ).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: t('en', 'catalogServiceCategories.manage') }),
  ).toBeNull();
  expect(patch.mock.calls[0]?.[0]).toBe(patchPath);
  expect(patch.mock.calls[0]?.[1]?.body).toEqual({
    name_en: 'Hair',
    name_ar: 'Hair AR',
    expected_revision: 2,
    visibility: 'BUSINESS',
  });
});
