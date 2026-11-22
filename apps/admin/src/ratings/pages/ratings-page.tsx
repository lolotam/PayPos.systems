'use client';

import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useRatingAverages } from '../api/use-rating-averages';
import { useRatingsList } from '../api/use-ratings-list';
import { initialRatingsFilters, ratingsRange } from '../model/ratings-filters';
import { RatingAveragesPanel } from '../ui/rating-averages-panel';
import { RatingsFiltersBar } from '../ui/ratings-filters';
import { RatingsListPanel } from '../ui/ratings-list-panel';

export function RatingsPage({
  companyId,
  userId,
  business,
}: {
  companyId: string;
  userId: string;
  business: WorkspaceBusinessRead;
}) {
  const locale = useLocale();
  const [filters, setFilters] = useState(() =>
    initialRatingsFilters(business.branches, new Date()),
  );
  const range = ratingsRange(filters, business.branches);
  const averages = useRatingAverages(companyId, userId, business.id, range);
  const list = useRatingsList(companyId, userId, business.id, range, filters.employeeId);
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'ratings.title')} description={t(locale, 'ratings.lead')} />
      <RatingsFiltersBar
        filters={filters}
        branches={business.branches}
        employees={averages.data?.items ?? []}
        onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
      />
      <RatingAveragesPanel averages={averages} employeeId={filters.employeeId} />
      <RatingsListPanel list={list} />
    </section>
  );
}
