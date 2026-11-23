'use client';

import type { RatingAverages } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import type { UseQueryResult } from '@tanstack/react-query';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useLocale } from '@/shared/locale/locale-context';
import { sortAverages } from '../model/rating-text';
import { ratingsFailureMessage } from '../model/ratings-failure';
import { averageColumns } from './ratings-columns';
import { RatingsGrid } from './ratings-grid';
import { RatingsNotice } from './ratings-notice';
import { RatingsRetryButton } from './ratings-retry-button';

export function RatingAveragesPanel({
  averages,
  employeeId,
}: {
  averages: UseQueryResult<RatingAverages>;
  employeeId: string;
}) {
  const locale = useLocale();
  const proof = readAccessProof(averages);
  if (proof === 'pending') return <RatingsNotice kind="loading" />;
  if (proof !== 'granted' || !averages.data) {
    const notice = (
      <RatingsNotice kind="error" message={ratingsFailureMessage(averages.error, locale)} />
    );
    if (proof !== 'failed') return notice;
    // القائمة بتنتظر شهر المتوسطات، فبدون إعادة محاولة هنا الصفحة كلها بتفضل واقفة بعد أول فشل عابر.
    return (
      <div className="flex flex-col items-center gap-2">
        {notice}
        <RatingsRetryButton busy={averages.isFetching} onRetry={() => void averages.refetch()} />
      </div>
    );
  }
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
