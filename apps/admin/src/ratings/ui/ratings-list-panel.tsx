'use client';

import type { RatingsListPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useLocale } from '@/shared/locale/locale-context';
import { ratingsFailureMessage } from '../model/ratings-failure';
import { ratingsListView } from '../model/ratings-list-view';
import { useDataReadThisVisit } from '../model/use-data-read-this-visit';
import { ratingColumns } from './ratings-columns';
import { RatingsGrid } from './ratings-grid';
import { RatingsNotice } from './ratings-notice';
import { RatingsRetryButton } from './ratings-retry-button';

export function RatingsListPanel({
  list,
}: {
  list: UseInfiniteQueryResult<InfiniteData<RatingsListPage>>;
}) {
  const locale = useLocale();
  const view = ratingsListView(list, useDataReadThisVisit(list));
  if (view === 'loading') return <RatingsNotice kind="loading" />;
  const failure = ratingsFailureMessage(list.error, locale);
  // الصفحة التالية الفاشلة بتتعاد بنفس المؤشر؛ أي فشل تاني (إعادة قراءة الصفحات) بتتعاد قراءته كلها.
  const retry = () => void (list.isFetchNextPageError ? list.fetchNextPage() : list.refetch());
  const retryButton = <RatingsRetryButton busy={list.isFetching} onRetry={retry} />;
  if (view === 'refused') return <RatingsNotice kind="error" message={failure} />;
  const rows = list.data?.pages.flatMap((page) => page.items) ?? [];
  const retrying = view === 'ready-with-error';
  if (view === 'failed' || (retrying && rows.length === 0))
    return (
      <div className="flex flex-col items-center gap-2">
        <RatingsNotice kind="error" message={failure} />
        {retryButton}
      </div>
    );
  if (rows.length === 0)
    return <RatingsNotice kind="empty" message={t(locale, 'ratings.emptyList')} />;
  return (
    <div className="flex flex-col gap-4">
      <RatingsGrid
        title={t(locale, 'ratings.listTitle')}
        rows={rows}
        columns={ratingColumns(locale)}
        getRowId={(row) => row.id}
      />
      {retrying ? (
        <div className="flex flex-col items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
          {retryButton}
        </div>
      ) : list.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          className="self-center"
          disabled={list.isFetchingNextPage}
          onClick={() => void list.fetchNextPage()}
        >
          {t(locale, 'ratings.loadMore')}
        </Button>
      ) : null}
    </div>
  );
}
