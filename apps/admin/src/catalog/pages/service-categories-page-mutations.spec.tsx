import { t } from '@pospay/i18n';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  categoryA,
  categoryAId,
  detailA,
  findPanel,
  renderPage,
  selectRow,
  setupCreateCategoryMocks,
} from './service-categories-page.fixtures';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());

vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post, PATCH: patch }),
}));

vi.mock('@/shared/locale/locale-context', () => ({
  useLocale: () => 'en',
}));

const createdId = '01920000-0000-7000-8000-0000000000dd';

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it('12. Create: refuses empty Arabic name, shows error, and opens detail on valid submission', async () => {
  setupCreateCategoryMocks(get, post, createdId);
  renderPage('en');

  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.create') }));

  const nameEnInput = screen.getByLabelText(t('en', 'catalogServiceCategories.nameEn'));
  fireEvent.change(nameEnInput, { target: { value: 'Spa' } });

  const createBtns = screen.getAllByRole('button', {
    name: t('en', 'catalogServiceCategories.create'),
  });
  const submitBtn = createBtns[createBtns.length - 1];
  if (!submitBtn) throw new Error('submit button not found');
  fireEvent.click(submitBtn);

  expect(await screen.findByText(t('en', 'catalogServiceCategories.nameRequired'))).toBeTruthy();
  expect(post).not.toHaveBeenCalled();

  const nameArInput = screen.getByLabelText(t('en', 'catalogServiceCategories.nameAr'));
  fireEvent.change(nameArInput, { target: { value: 'Spa (ar)' } });
  fireEvent.click(submitBtn);

  await waitFor(() => {
    expect(post).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/service-categories',
      expect.objectContaining({ body: { name_en: 'Spa', name_ar: 'Spa (ar)' } }),
    );
  });

  const panelHeading = await screen.findByRole('heading', {
    name: t('en', 'catalogServiceCategories.detailTitle'),
  });
  expect(panelHeading).toBeTruthy();

  const panel = await findPanel('en');
  expect(within(panel).getByText('Spa')).toBeTruthy();
});

it('13. Rename with 409 SERVICE_CATEGORY_REVISION_CONFLICT: displays refusal and reload button', async () => {
  get.mockImplementation((path: string, req?: { params?: { path?: { categoryId?: string } } }) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: [categoryA], next_cursor: null },
        response: { status: 200 },
      });
    }
    if (req?.params?.path?.categoryId === categoryAId) {
      return Promise.resolve({ data: detailA, response: { status: 200 } });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });

  patch.mockResolvedValueOnce({
    error: {
      code: 'SERVICE_CATEGORY_REVISION_CONFLICT',
      message_ar: 'Revision conflict (ar)',
      message_en: 'Another manager changed this category. Reload the latest record before saving.',
    },
    response: { status: 409 },
  });

  renderPage('en');
  await screen.findByText(categoryA.name_en);
  selectRow(categoryA.name_en, 'en');

  const saveBtn = await screen.findByRole('button', {
    name: t('en', 'catalogServiceCategories.save'),
  });
  fireEvent.click(saveBtn);

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Another manager changed this category');
  expect(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.reload') }),
  ).toBeTruthy();
});
