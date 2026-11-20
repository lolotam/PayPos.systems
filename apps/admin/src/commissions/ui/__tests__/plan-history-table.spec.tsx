import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { t } from '@pospay/i18n';
import { PlanHistoryTable } from '../plan-history-table';
import { versionItem } from '../../api/__tests__/plan-http';

vi.mock('@/shared/locale/locale-context', () => ({ useLocale: () => 'en' }));

const EMP = 'emp-1';

function rows() {
  return screen.getAllByRole('row').slice(1);
}

function rowVersion(row: HTMLElement) {
  return within(row).getAllByRole('cell')[0]?.textContent;
}

const NEWEST = versionItem(EMP, 2, {
  base: { enabled: true, calc: { kind: 'PCT', bps: 500 } },
  tiers: {
    enabled: false,
    mode: 'MARGINAL',
    accumulator: 'SESSIONS',
    steps: [{ from: { kind: 'SESSIONS', value: 4 }, calc: { kind: 'PCT', bps: 100 } }],
  },
});
const OLDEST = versionItem(EMP, 1, {
  effective_from: '2025-06-01',
});

function renderTable(
  items: readonly (typeof NEWEST)[],
  timeZone = 'Asia/Kuwait',
  hasNextPage = false,
) {
  return render(
    <PlanHistoryTable
      items={items}
      timeZone={timeZone}
      hasNextPage={hasNextPage}
      loadingMore={false}
      loadMoreError={false}
      onLoadMore={vi.fn()}
    />,
  );
}

it('lists stored versions newest first with their dates and the whole-period mark', () => {
  renderTable([NEWEST, OLDEST]);
  const list = rows();
  expect(rowVersion(list[0] as HTMLElement)).toBe('2');
  expect(rowVersion(list[1] as HTMLElement)).toBe('1');
  expect(list[0]?.textContent).toContain(t('en', 'commissionPlanBuilder.wholeNo'));
});

it('shows created_at in the business time zone, not UTC', () => {
  const createdLateUtc = versionItem(EMP, 3, { created_at: '2026-01-04T22:30:00Z' });
  renderTable([createdLateUtc]);
  const row = rows()[0] as HTMLElement;
  expect(within(row).getAllByRole('cell')[4]?.textContent).toBe('January 5, 2026');
});

it('shows a disabled block that kept its settings as off with the settings beside it', () => {
  renderTable([NEWEST]);
  const newestRow = rows()[0] as HTMLElement;
  expect(newestRow.textContent).toContain(t('en', 'commissionPlanBuilder.blockOff'));
  expect(newestRow.textContent).toContain('500');
  expect(newestRow.textContent).toContain(t('en', 'commissionPlanBuilder.modeMarginal'));
  expect(newestRow.textContent).toContain(t('en', 'commissionPlanBuilder.accumulatorSessions'));
  expect(newestRow.textContent).toContain('1');
});

it('appends the next page in order when load more answers', () => {
  const onLoadMore = vi.fn();
  const view = render(
    <PlanHistoryTable
      items={[NEWEST]}
      timeZone="Asia/Kuwait"
      hasNextPage
      loadingMore={false}
      loadMoreError={false}
      onLoadMore={onLoadMore}
    />,
  );
  expect(rows().length).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: t('en', 'commissionPlanBuilder.loadMore') }));
  expect(onLoadMore).toHaveBeenCalledTimes(1);
  view.rerender(
    <PlanHistoryTable
      items={[NEWEST, OLDEST]}
      timeZone="Asia/Kuwait"
      hasNextPage={false}
      loadingMore={false}
      loadMoreError={false}
      onLoadMore={onLoadMore}
    />,
  );
  const list = rows();
  expect(rowVersion(list[0] as HTMLElement)).toBe('2');
  expect(rowVersion(list[1] as HTMLElement)).toBe('1');
});

it('shows the could-not-load-more message and disables the button while the next page loads', () => {
  const view = render(
    <PlanHistoryTable
      items={[NEWEST]}
      timeZone="Asia/Kuwait"
      hasNextPage
      loadingMore
      loadMoreError={false}
      onLoadMore={vi.fn()}
    />,
  );
  const button = screen.getByRole('button', {
    name: t('en', 'commissionPlanBuilder.loadMore'),
  }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  view.rerender(
    <PlanHistoryTable
      items={[NEWEST]}
      timeZone="Asia/Kuwait"
      hasNextPage
      loadingMore={false}
      loadMoreError
      onLoadMore={vi.fn()}
    />,
  );
  expect(screen.getByText(t('en', 'commissionPlanBuilder.couldNotLoadMore'))).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t('en', 'commissionPlanBuilder.loadMore') }),
  ).toBeTruthy();
});
