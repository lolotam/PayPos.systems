import type { RatingAverageItem, RatingsListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Star } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { ratingName } from '../model/rating-text';

function StarsValue({ value }: { value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Star aria-hidden="true" className="size-4 text-warning" />
      {value}
    </span>
  );
}

export function averageColumns(locale: Locale): ColumnDef<RatingAverageItem>[] {
  return [
    {
      id: 'employee',
      header: t(locale, 'ratings.colEmployee'),
      cell: ({ row }) => ratingName(row.original, locale),
    },
    {
      id: 'average',
      header: t(locale, 'ratings.colAverage'),
      cell: ({ row }) => <StarsValue value={row.original.average} />,
    },
    { id: 'count', header: t(locale, 'ratings.colCount'), cell: ({ row }) => row.original.count },
  ];
}

export function ratingColumns(locale: Locale): ColumnDef<RatingsListItem>[] {
  const separator = t(locale, 'ratingRequest.namesSeparator');
  return [
    {
      id: 'date',
      header: t(locale, 'ratings.colDate'),
      cell: ({ row }) => row.original.business_date,
    },
    {
      id: 'branch',
      header: t(locale, 'ratings.colBranch'),
      cell: ({ row }) => ratingName(row.original.branch, locale),
    },
    {
      id: 'performers',
      header: t(locale, 'ratings.colPerformers'),
      cell: ({ row }) => row.original.performers.map((p) => ratingName(p, locale)).join(separator),
    },
    {
      id: 'stars',
      header: t(locale, 'ratings.colStars'),
      cell: ({ row }) => <StarsValue value={row.original.stars} />,
    },
    {
      id: 'comment',
      header: t(locale, 'ratings.colComment'),
      cell: ({ row }) => row.original.comment ?? t(locale, 'ratings.noComment'),
    },
  ];
}
