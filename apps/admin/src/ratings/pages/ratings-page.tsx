'use client';

import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useMemo, useState } from 'react';
import { readAccessProof } from '@/shared/api/read-access-proof';
import { useLocale } from '@/shared/locale/locale-context';
import { ratingsKey } from '../api/ratings-client';
import { useRatingAverages } from '../api/use-rating-averages';
import { useRatingsList } from '../api/use-ratings-list';
import {
  availableEmployeeId,
  averagesQuery,
  initialRatingsFilters,
  listRange,
} from '../model/ratings-filters';
import { useRatingsGate } from '../model/use-ratings-gate';
import { useRatingsMonth } from '../model/use-ratings-month';
import { RatingAveragesPanel } from '../ui/rating-averages-panel';
import { RatingsFiltersBar } from '../ui/ratings-filters';
import { RatingsListPanel } from '../ui/ratings-list-panel';
import { RatingsNotice } from '../ui/ratings-notice';

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
  const [filters, setFilters] = useState(initialRatingsFilters);
  const averages = useRatingAverages(companyId, userId, business.id, averagesQuery(filters));
  const month = useRatingsMonth(averages, filters.month);
  // أسماء الموظفات من قراءة ناجحة في الزيارة الحالية فقط، مش من الكاش.
  const employees = readAccessProof(averages) === 'granted' ? (averages.data?.items ?? []) : [];
  const employeeId = availableEmployeeId(filters.employeeId, employees);
  const list = useRatingsList(
    companyId,
    userId,
    business.id,
    listRange(filters, month),
    employeeId,
  );
  const scope = useMemo(
    () => ratingsKey(companyId, userId, business.id),
    [companyId, userId, business.id],
  );
  const gate = useRatingsGate(scope, averages, list);
  const open = gate === 'open';
  // شهر مجهول بعد فشل المتوسطات: القائمة ما بتقرأش، وخطأ المتوسطات هو اللي بيتعرض.
  const listWaiting = month === null && readAccessProof(averages) !== 'pending';
  return (
    <section className="flex min-w-0 flex-col gap-6 text-start">
      <PageHeader title={t(locale, 'ratings.title')} description={t(locale, 'ratings.lead')} />
      <RatingsFiltersBar
        filters={{ ...filters, month, employeeId: open ? employeeId : '' }}
        branches={business.branches}
        employees={open ? employees : []}
        onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
      />
      {gate === 'refused' ? (
        <RatingsNotice kind="error" message={t(locale, 'ratings.notAllowed')} />
      ) : null}
      {gate === 'rereading' ? <RatingsNotice kind="loading" /> : null}
      {open ? <RatingAveragesPanel averages={averages} employeeId={employeeId} /> : null}
      {open && !listWaiting ? <RatingsListPanel list={list} /> : null}
    </section>
  );
}
