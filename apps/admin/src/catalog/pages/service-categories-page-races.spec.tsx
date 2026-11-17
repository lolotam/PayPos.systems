import { t } from '@pospay/i18n';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { formatCount } from '../model/service-category-closing';
import {
  categoryA,
  categoryAId,
  categoryB,
  categoryBId,
  closingId,
  closingBId,
  detailA,
  detailB,
  findPanel,
  findRow,
  pendingStatus,
  renderPage,
  selectRow,
  setupClosingFlowGet,
  setupRace1Get,
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

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  patch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it('9. Reload pick-up: shows closing text on load without a POST when pending_closing_id is present', async () => {
  get.mockImplementation((path: string, req?: { params?: { path?: { categoryId?: string } } }) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: [categoryA], next_cursor: null },
        response: { status: 200 },
      });
    }
    if (path.includes('/closings/'))
      return Promise.resolve({ data: pendingStatus, response: { status: 200 } });
    if (req?.params?.path?.categoryId === categoryAId) {
      return Promise.resolve({
        data: { ...detailA, pending_closing_id: closingId, closed_at: null },
        response: { status: 200 },
      });
    }
    return Promise.resolve({ data: {}, response: { status: 200 } });
  });

  renderPage('en');
  await screen.findByText(categoryA.name_en);
  selectRow(categoryA.name_en, 'en');

  const panel = await findPanel('en');
  expect(await within(panel).findByText(t('en', 'catalogServiceCategories.closing'))).toBeTruthy();

  await waitFor(() => {
    const rowA = findRow(categoryA.name_en);
    expect(within(rowA).getByText(t('en', 'catalogServiceCategories.closing'))).toBeTruthy();
  });

  expect(post).not.toHaveBeenCalled();
});

it('10. Race 1: finished job is not polled again even if stale detail returns old pending_closing_id', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  setupRace1Get(get);

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
  const panel = await findPanel('en');
  expect(
    within(panel).getByText(formatCount(t('en', 'catalogServiceCategories.closedWithCount'), 450)),
  ).toBeTruthy();

  const statusCallsCount = () =>
    get.mock.calls.filter(
      ([p, opts]) =>
        (p as string).includes('/closings/') && opts?.params?.path?.closingId === closingId,
    ).length;
  const initialCalls = statusCallsCount();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(6_300);
  });
  expect(statusCallsCount()).toBe(initialCalls);

  selectRow(categoryB.name_en, 'en');
  await screen.findByText(categoryB.name_en);

  selectRow(categoryA.name_en, 'en');
  await waitFor(async () => {
    const panelA = await findPanel('en');
    expect(within(panelA).queryByText(t('en', 'catalogServiceCategories.closing'))).toBeNull();
  });
  expect(statusCallsCount()).toBe(initialCalls);
});

it('11. Race 2: late reply does not land on another row (202 and 200 variants)', async () => {
  let resolvePost: (value: unknown) => void = () => undefined;
  post.mockReturnValueOnce(
    new Promise((resolve) => {
      resolvePost = resolve;
    }),
  );

  get.mockImplementation((path: string, req?: { params?: { path?: { categoryId?: string } } }) => {
    if (path === '/v1/businesses/{businessId}/service-categories') {
      return Promise.resolve({
        data: { items: [categoryA, categoryB], next_cursor: null },
        response: { status: 200 },
      });
    }
    if (req?.params?.path?.categoryId === categoryAId)
      return Promise.resolve({ data: detailA, response: { status: 200 } });
    if (req?.params?.path?.categoryId === categoryBId)
      return Promise.resolve({ data: detailB, response: { status: 200 } });
    return Promise.resolve({ data: {}, response: { status: 200 } });
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

  selectRow(categoryB.name_en, 'en');
  await screen.findByText(categoryB.name_en);

  await act(async () => {
    resolvePost({ data: { closing_id: closingId, status: 'pending' }, response: { status: 202 } });
  });

  const rowA = findRow(categoryA.name_en);
  expect(within(rowA).getByText(t('en', 'catalogServiceCategories.closing'))).toBeTruthy();

  const panelB = await findPanel('en');
  expect(within(panelB).queryByRole('status')).toBeNull();
  expect(within(panelB).queryByRole('alert')).toBeNull();

  post.mockResolvedValueOnce({
    data: { ...detailA, revision: 2, closed_at: '2026-10-05T10:00:00Z', services_closed: 5 },
    response: { status: 200 },
  });
});

it('Concurrent jobs: A completes after B starts and keeps its own result', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let aClosed = false;
  setupClosingFlowGet(get, () => aClosed);
  post
    .mockResolvedValueOnce({ data: { closing_id: closingId, status: 'pending' }, response: { status: 202 } })
    .mockResolvedValueOnce({
      data: { closing_id: closingBId, status: 'pending' },
      response: { status: 202 },
    });
  renderPage('en');

  await screen.findByText(categoryA.name_en);
  selectRow(categoryA.name_en, 'en');
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategories.closeCategory') }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }));
  await waitFor(() =>
    expect(
      within(findRow(categoryA.name_en)).getByText(t('en', 'catalogServiceCategories.closing')),
    ).toBeTruthy(),
  );

  selectRow(categoryB.name_en, 'en');
  fireEvent.click(
    await screen.findByRole('button', { name: t('en', 'catalogServiceCategories.closeCategory') }),
  );
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.confirm') }));
  await waitFor(() =>
    expect(
      within(findRow(categoryB.name_en)).getByText(t('en', 'catalogServiceCategories.closing')),
    ).toBeTruthy(),
  );

  aClosed = true;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2_100);
  });
  fireEvent.click(screen.getByRole('button', { name: t('en', 'catalogServiceCategories.tabClosed') }));
  expect(await screen.findByText(categoryA.name_en)).toBeTruthy();
  expect(
    within(findRow(categoryA.name_en)).getByText(t('en', 'catalogServiceCategories.closed')),
  ).toBeTruthy();

  const tabs = screen.getByRole('group');
  fireEvent.click(
    within(tabs).getByRole('button', { name: t('en', 'catalogServiceCategories.tabOpen') }),
  );
  expect(await screen.findByText(categoryB.name_en)).toBeTruthy();
  expect(
    within(findRow(categoryB.name_en)).getByText(t('en', 'catalogServiceCategories.closing')),
  ).toBeTruthy();
});
