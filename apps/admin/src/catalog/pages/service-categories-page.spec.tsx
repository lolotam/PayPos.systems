import { t, type Locale } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatCount } from '../model/service-category-closing';
import {
  categoryA,
  categoryB,
  closedCategoryC,
  closingId,
  detailA,
  findPanel,
  findRow,
  renderPage,
  selectRow,
  setupCategoriesGet,
  setupClosingFlowGet,
  setupReopenFlowGet,
} from './service-categories-page.fixtures';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const localeState = vi.hoisted(() => ({ selected: 'en' as Locale }));

vi.mock('@/shared/api/client', () => ({
  apiClient: () => ({ GET: get, POST: post, PATCH: patch }),
}));

vi.mock('@/shared/locale/locale-context', () => ({
  useLocale: () => localeState.selected,
}));

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
  localeState.selected = 'en';
});

afterEach(() => {
  vi.useRealTimers();
});

it('1. Tabs: shows open categories by default, switches to closed on click', async () => {
  setupCategoriesGet(get);
  renderPage('en');

  expect(await screen.findByText(categoryA.name_en)).toBeTruthy();
  expect(screen.getByText(categoryB.name_en)).toBeTruthy();
  expect(screen.queryByText(closedCategoryC.name_en)).toBeNull();

  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.tabClosed') }),
  );

  expect(await screen.findByText(closedCategoryC.name_en)).toBeTruthy();
  expect(screen.queryByText(categoryA.name_en)).toBeNull();
  expect(screen.queryByText(categoryB.name_en)).toBeNull();

  const row = findRow(closedCategoryC.name_en);
  expect(within(row).getByText(t('en', 'catalogServiceCategories.closed'))).toBeTruthy();

  const listCalls = get.mock.calls.filter(
    ([p]) => p === '/v1/businesses/{businessId}/service-categories',
  );
  expect(listCalls.at(-1)?.[1]?.params?.query?.status).toBe('closed');
});

it('2. The confirmation names the count: names 450 and posts expected revision and count', async () => {
  setupCategoriesGet(get);
  post.mockResolvedValueOnce({
    data: { ...detailA, revision: 2, closed_at: '2026-10-05T10:00:00Z', services_closed: 450 },
    response: { status: 200 },
  });
  renderPage('en');

  await screen.findByText(categoryA.name_en);
  selectRow(categoryA.name_en, 'en');

  const closeBtn = await screen.findByRole('button', {
    name: t('en', 'catalogServiceCategories.closeCategory'),
  });
  fireEvent.click(closeBtn);

  const expectedConfirm = formatCount(t('en', 'catalogServiceCategories.confirmClose'), 450);
  expect(await screen.findByText(expectedConfirm)).toBeTruthy();

  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }),
  );

  await waitFor(() => {
    expect(post).toHaveBeenCalledWith(
      '/v1/businesses/{businessId}/service-categories/{categoryId}/close',
      expect.objectContaining({
        body: { expected_revision: categoryA.revision, expected_service_count: 450 },
      }),
    );
  });
});

it('3. The 202 path (ar locale, the SI-Q30 check): shows closing, completes, and shows closed badge', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  localeState.selected = 'ar';
  let aClosed = false;
  setupClosingFlowGet(get, () => aClosed);

  post.mockResolvedValueOnce({
    data: { closing_id: closingId, status: 'pending' },
    response: { status: 202 },
  });
  renderPage('ar');

  await screen.findByText(categoryA.name_ar);
  selectRow(categoryA.name_ar, 'ar');

  const closeBtn = await screen.findByRole('button', {
    name: t('ar', 'catalogServiceCategories.closeCategory'),
  });
  fireEvent.click(closeBtn);
  const confirmBtn = await screen.findByRole('button', {
    name: t('ar', 'catalogServiceCategories.confirm'),
  });
  fireEvent.click(confirmBtn);

  await waitFor(async () => {
    const panel = await findPanel('ar');
    expect(within(panel).getByText(t('ar', 'catalogServiceCategories.closing'))).toBeTruthy();
    const row = findRow(categoryA.name_ar);
    expect(within(row).getByText(t('ar', 'catalogServiceCategories.closing'))).toBeTruthy();
  });

  aClosed = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });

  const panelAfter = await findPanel('ar');
  const expectedDone = formatCount(t('ar', 'catalogServiceCategories.closedWithCount'), 450);
  await waitFor(() => expect(within(panelAfter).getByText(expectedDone)).toBeTruthy());
  await waitFor(() =>
    expect(
      screen.queryAllByText(categoryA.name_ar).some((element) => element.closest('tr')),
    ).toBe(false),
  );

  fireEvent.click(
    screen.getByRole('button', { name: t('ar', 'catalogServiceCategories.tabClosed') }),
  );
  expect(await screen.findByText(categoryA.name_ar)).toBeTruthy();
  expect(
    within(findRow(categoryA.name_ar)).getByText(t('ar', 'catalogServiceCategories.closed')),
  ).toBeTruthy();
});

it('4. Reopen through 202: displays reopening and reopened texts with count', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setupReopenFlowGet(get);

  post.mockResolvedValueOnce({
    data: { closing_id: closingId, status: 'pending' },
    response: { status: 202 },
  });
  renderPage('en');

  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.tabClosed') }),
  );

  await screen.findByText(closedCategoryC.name_en);
  selectRow(closedCategoryC.name_en, 'en');

  const reopenBtn = await screen.findByRole('button', {
    name: t('en', 'catalogServiceCategories.reopenCategory'),
  });
  fireEvent.click(reopenBtn);

  expect(
    await screen.findByText(formatCount(t('en', 'catalogServiceCategories.confirmReopen'), 12)),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }),
  );

  await waitFor(async () => {
    const panel = await findPanel('en');
    expect(within(panel).getByText(t('en', 'catalogServiceCategories.reopening'))).toBeTruthy();
  });

  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });

  const panelAfter = await findPanel('en');
  expect(
    within(panelAfter).getByText(
      formatCount(t('en', 'catalogServiceCategories.reopenedWithCount'), 12),
    ),
  ).toBeTruthy();
});

it('5. A synchronous 200: shows done text immediately and makes no status GET', async () => {
  setupCategoriesGet(get);
  post.mockResolvedValueOnce({
    data: { ...detailA, revision: 2, closed_at: '2026-10-05T10:00:00Z', services_closed: 3 },
    response: { status: 200 },
  });
  renderPage('en');

  await screen.findByText(categoryA.name_en);
  selectRow(categoryA.name_en, 'en');

  const closeBtn = await screen.findByRole('button', {
    name: t('en', 'catalogServiceCategories.closeCategory'),
  });
  fireEvent.click(closeBtn);
  fireEvent.click(
    screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }),
  );

  const panel = await findPanel('en');
  expect(
    within(panel).getByText(formatCount(t('en', 'catalogServiceCategories.closedWithCount'), 3)),
  ).toBeTruthy();

  const statusCalls = get.mock.calls.filter(([p]) => (p as string).includes('/closings/'));
  expect(statusCalls.length).toBe(0);
});

it.each(['en', 'ar'] as const)(
  '14. Both locales: renders with dir %s and appropriate locale strings',
  async (locale) => {
    localeState.selected = locale;
    setupCategoriesGet(get);
    renderPage(locale);

    const nameToFind = locale === 'ar' ? categoryA.name_ar : categoryA.name_en;
    await screen.findByText(nameToFind);
    const row = findRow(nameToFind);
    expect(row.closest('[dir]')?.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');

    const tabGroup = screen.getByRole('group');
    expect(
      within(tabGroup).getByRole('button', {
        name: t(locale, 'catalogServiceCategories.tabOpen'),
      }),
    ).toBeTruthy();
    expect(
      within(tabGroup).getByRole('button', {
        name: t(locale, 'catalogServiceCategories.tabClosed'),
      }),
    ).toBeTruthy();
    expect(
      within(row).getByRole('button', { name: t(locale, 'catalogServiceCategories.manage') }),
    ).toBeTruthy();
  },
);
