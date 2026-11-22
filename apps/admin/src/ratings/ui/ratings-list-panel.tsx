'use client';

import type { RatingsListPage } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { InfiniteData, UseInfiniteQueryResult } from '@tanstack/react-query';
import { useLocale } from '@/shared/locale/locale-context';
import { ratingsFailureMessage } from '../model/ratings-failure';
import { ratingColumns } from './ratings-columns';
import { RatingsGrid } from './ratings-grid';
import { RatingsNotice } from './ratings-notice';

export function RatingsListPanel({
  list,
}: {
  list: UseInfiniteQueryResult<InfiniteData<RatingsListPage>>;
}) {
  const locale = useLocale();
  if (list.isPending) return <RatingsNotice kind="loading" />;
  if (list.isError)
    return <RatingsNotice kind="error" message={ratingsFailureMessage(list.error, locale)} />;
  const rows = list.data.pages.flatMap((page) => page.items);
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
      {list.hasNextPage ? (
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
