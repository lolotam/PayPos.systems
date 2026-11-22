'use client';

import type { RatingAverages } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { UseQueryResult } from '@tanstack/react-query';
import { useLocale } from '@/shared/locale/locale-context';
import { sortAverages } from '../model/rating-text';
import { ratingsFailureMessage } from '../model/ratings-failure';
import { averageColumns } from './ratings-columns';
import { RatingsGrid } from './ratings-grid';
import { RatingsNotice } from './ratings-notice';

export function RatingAveragesPanel({
  averages,
  employeeId,
}: {
  averages: UseQueryResult<RatingAverages>;
  employeeId: string;
}) {
  const locale = useLocale();
  if (averages.isPending) return <RatingsNotice kind="loading" />;
  if (averages.isError)
    return <RatingsNotice kind="error" message={ratingsFailureMessage(averages.error, locale)} />;
  const items = averages.data.items.filter(
    (item) => !employeeId || item.employee_id === employeeId,
  );
  if (items.length === 0)
    return <RatingsNotice kind="empty" message={t(locale, 'ratings.emptyAverages')} />;
  return (
    <RatingsGrid
      title={t(locale, 'ratings.averagesTitle')}
      rows={sortAverages(items, locale)}
      columns={averageColumns(locale)}
      getRowId={(item) => item.employee_id}
    />
  );
}
