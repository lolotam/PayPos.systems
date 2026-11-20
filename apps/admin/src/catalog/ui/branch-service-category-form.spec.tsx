import type { ReactNode } from 'react';
import type { ServiceCategoryBranchListItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { branchId, branchCategory } from '../pages/branch-service-categories-actions.fixtures';
import { BranchServiceCategoryForm } from './branch-service-category-form';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const put = vi.hoisted(() => vi.fn());
const localeState = vi.hoisted(() => ({ selected: 'en' as 'en' | 'ar' }));
vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post, PATCH: patch, PUT: put }),
}));
vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => localeState.selected }));

function renderForm(props: {
  mode: 'create' | 'rename';
  record?: ServiceCategoryBranchListItem;
  onSeeAvailable?: () => void;
}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <BranchServiceCategoryForm
      companyId="01920000-0000-7000-8000-000000000001"
      businessId="01920000-0000-7000-8000-000000000002"
      userId="01920000-0000-7000-8000-000000000003"
      branchId={branchId}
      mode={props.mode}
      record={props.record}
      onReload={() => undefined}
      onSeeAvailable={props.onSeeAvailable}
    />,
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
}

function fillNames(nameEn: string, nameAr: string) {
  fireEvent.change(screen.getByLabelText(t('en', 'catalogServiceCategories.nameEn')), {
    target: { value: nameEn },
  });
  fireEvent.change(screen.getByLabelText(t('en', 'catalogServiceCategories.nameAr')), {
    target: { value: nameAr },
  });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  put.mockReset();
  localeState.selected = 'en';
});

it('refuses a create with no visibility choice and posts nothing', async () => {
  renderForm({ mode: 'create' });
  fillNames('Spa', 'Spa AR');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.create') }));
  expect(
    await screen.findByText(t('en', 'catalogServiceCategoryBranches.visibilityRequired')),
  ).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('refuses a create with an empty Arabic name', async () => {
  renderForm({ mode: 'create' });
  fillNames('Spa', '');
  fireEvent.click(
    screen.getByRole('radio', {
      name: t('en', 'catalogServiceCategoryBranches.visibilityPrivate'),
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.create') }));
  expect(await screen.findByText(t('en', 'catalogServiceCategories.nameRequired'))).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('shows the taken-name refusal with a jump to the available tab', async () => {
  post.mockResolvedValue({
    error: {
      code: 'SERVICE_CATEGORY_NAME_TAKEN',
      message_ar: 'This name is taken.',
      message_en: 'This name is taken.',
    },
    response: { status: 409 },
  });
  renderForm({ mode: 'create', onSeeAvailable: () => undefined });
  fillNames('Spa', 'Spa AR');
  fireEvent.click(
    screen.getByRole('radio', { name: t('en', 'catalogServiceCategoryBranches.visibilityShared') }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.create') }));
  expect(await screen.findByText('This name is taken.')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategoryBranches.seeAvailable') }),
  ).toBeTruthy();
});

it('renames from the seeded names and posts no visibility key', async () => {
  patch.mockResolvedValue({
    data: branchCategory({ visibility: 'BRANCH', owner_branch_id: branchId, revision: 4 }),
    response: { status: 200 },
  });
  renderForm({
    mode: 'rename',
    record: branchCategory({
      visibility: 'BRANCH',
      owner_branch_id: branchId,
      revision: 3,
      name_en: 'Old En',
      name_ar: 'Old AR',
    }),
  });
  expect(screen.getByLabelText(t('en', 'catalogServiceCategories.nameEn'))).toHaveProperty(
    'value',
    'Old En',
  );
  expect(screen.queryByRole('radio')).toBeNull();
  fillNames('New En', 'New AR');
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.save') }));
  await vi.waitFor(() => expect(patch).toHaveBeenCalled());
  const call = patch.mock.calls[0];
  expect(call?.[0]).toBe(
    '/v1/businesses/{businessId}/branches/{branchId}/service-categories/{categoryId}',
  );
  expect(call?.[1]?.body).toEqual({
    name_en: 'New En',
    name_ar: 'New AR',
    expected_revision: 3,
  });
  expect(call?.[1]?.body).not.toHaveProperty('visibility');
});

it('associates each name label with its own mounted form input', () => {
  const first = renderForm({ mode: 'create' });
  first.container.hidden = true;
  const second = renderForm({ mode: 'create' });
  const firstInput = first.container.querySelector('input[name="name_en"]');
  const secondInput = second.container.querySelector('input[name="name_en"]');
  const label = [...second.container.querySelectorAll('label')].find(
    (item) => item.textContent === t('en', 'catalogServiceCategories.nameEn'),
  );
  expect(label?.control).toBe(secondInput);
  expect(label?.control).not.toBe(firstInput);
});
