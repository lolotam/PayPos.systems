'use client';

import type { RatingAverageItem, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { ratingName, sortAverages } from '../model/rating-text';
import type { RatingsFilters } from '../model/ratings-filters';
import { RatingsMonthField } from './ratings-month-field';

export function RatingsFiltersBar({
  filters,
  branches,
  employees,
  onChange,
}: {
  filters: RatingsFilters;
  branches: readonly WorkspaceBranch[];
  employees: readonly RatingAverageItem[];
  onChange: (next: Partial<RatingsFilters>) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <RatingsMonthField
        key={filters.month === null ? 'unknown' : 'known'}
        month={filters.month}
        onChange={(month) => onChange({ month, employeeId: '' })}
      />
      <div className="grid gap-1">
        <Label htmlFor="ratings-branch">{t(locale, 'ratings.branch')}</Label>
        <NativeSelect
          id="ratings-branch"
          value={filters.branchId}
          onChange={(event) => onChange({ branchId: event.target.value, employeeId: '' })}
        >
          <option value="">{t(locale, 'ratings.allBranches')}</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {ratingName(branch, locale)}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="ratings-employee">{t(locale, 'ratings.employee')}</Label>
        <NativeSelect
          id="ratings-employee"
          value={filters.employeeId}
          onChange={(event) => onChange({ employeeId: event.target.value })}
        >
          <option value="">{t(locale, 'ratings.allEmployees')}</option>
          {sortAverages(employees, locale).map((employee) => (
            <option key={employee.employee_id} value={employee.employee_id}>
              {ratingName(employee, locale)}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
