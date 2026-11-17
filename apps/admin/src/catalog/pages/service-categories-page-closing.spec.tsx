import { t } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatCount } from '../model/service-category-closing';
import {
  categoryA,
  categoryAId,
  closingId,
  detailA,
  findPanel,
  pendingStatus,
  renderPage,
  selectRow,
  setupFailedJobGet,
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

const countChangedError = {
  code: 'SERVICE_CATEGORY_COUNT_CHANGED',
  message_ar: 'Services changed (ar)',
  message_en:
    'The services under the category changed after you confirmed; reload and confirm again.',
};

const inProgressError = {
  code: 'SERVICE_CATEGORY_CLOSING_IN_PROGRESS',
  details: { closing_id: closingId },
  message_ar: 'Closing in progress (ar)',
  message_en: 'A close or reopen of this category is already running in the background.',
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it('6. A failed job and "try again": shows error in alert, retry refetches detail to 452 and clears alert', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let detailCount = 450;
  setupFailedJobGet(get, () => detailCount);

  post.mockResolvedValueOnce({
    data: { closing_id: closingId, status: 'pending' },
    response: { status: 202 },
  });

  renderPage('en');
  await screen.findByText(categoryA.name_en);
  selectRow(categoryA.name_en, 'en');

  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategories.closeCategory') }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }),
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(t('en', 'errors.SERVICE_CATEGORY_COUNT_CHANGED'));

  const retryBtn = within(alert).getByRole('button', {
    name: t('en', 'catalogServiceCategories.retry'),
  });
  detailCount = 452;
  fireEvent.click(retryBtn);

  const expectedConfirm = formatCount(t('en', 'catalogServiceCategories.confirmClose'), 452);
  expect(await screen.findByText(expectedConfirm)).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('7. Synchronous 409 SERVICE_CATEGORY_COUNT_CHANGED: shows message, refetches detail, and updates count', async () => {
  let detailCount = 450;
  get.mockImplementation((path: string, req?: { params?: { path?: { categoryId?: string } } }) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: [categoryA], next_cursor: null },
        response: { status: 200 },
      });
    }
    if (req?.params?.path?.categoryId === categoryAId) {
      return Promise.resolve({
        data: { ...detailA, open_service_count: detailCount },
        response: { status: 200 },
      });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });

  post.mockResolvedValueOnce({
    error: countChangedError,
    response: { status: 409 },
  });

  renderPage('en');
  await screen.findByText(categoryA.name_en);
  selectRow(categoryA.name_en, 'en');

  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategories.closeCategory') }),
  );
  detailCount = 455;
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }),
  );

  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain(
    'The services under the category changed after you confirmed',
  );

  const expectedUpdated = formatCount(t('en', 'catalogServiceCategories.confirmClose'), 455);
  expect(await screen.findByText(expectedUpdated)).toBeTruthy();
});

it('8. 409 SERVICE_CATEGORY_CLOSING_IN_PROGRESS with details.closing_id: starts polling status', async () => {
  get.mockImplementation((path: string, req?: { params?: { path?: { categoryId?: string } } }) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: [categoryA], next_cursor: null },
        response: { status: 200 },
      });
    }
    if (path.includes('/closings/'))
      return Promise.resolve({ data: pendingStatus, response: { status: 200 } });
    if (req?.params?.path?.categoryId === categoryAId)
      return Promise.resolve({ data: detailA, response: { status: 200 } });
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });

  post.mockResolvedValueOnce({
    error: inProgressError,
    response: { status: 409 },
  });

  renderPage('en');
  await screen.findByText(categoryA.name_en);
  selectRow(categoryA.name_en, 'en');

  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategories.closeCategory') }),
  );
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }),
  );

  const panel = await findPanel('en');
  expect(within(panel).getByText(t('en', 'catalogServiceCategories.closing'))).toBeTruthy();

  await waitFor(() => {
    const closingGets = get.mock.calls.filter(
      ([p, opts]) =>
        (p as string).includes('/closings/') && opts?.params?.path?.closingId === closingId,
    );
    expect(closingGets.length).toBeGreaterThanOrEqual(1);
  });

  expect(within(panel).queryByRole('alert')).toBeNull();
});
