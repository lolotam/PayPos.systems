'use client';
import type { LeaveHistoryQuery, WorkspaceBranch } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useState } from 'react';
import { useForm, type UseFormRegisterReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  offeredHistoryStatuses,
  offeredHistoryTypes,
  toHistoryQuery,
  type LeaveHistoryFilters,
} from '../model/leave-history-filters';

type Option = { value: string; label: string };

function filterSelect(
  id: string,
  label: string,
  options: Option[],
  registration: UseFormRegisterReturn,
) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect id={id} {...registration}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </NativeSelect>
    </div>
  );
}

function typeOptions(locale: Locale, absenceOffered: boolean): Option[] {
  return [
    { value: '', label: t(locale, 'leaveHistory.allTypes') },
    ...offeredHistoryTypes(absenceOffered).map((value) => ({
      value,
      label: t(
        locale,
        value === 'UNEXCUSED_ABSENCE' ? 'leaveHistory.absenceType' : `leave.${value}`,
      ),
    })),
  ];
}

function statusOptions(locale: Locale, absenceOffered: boolean): Option[] {
  return [
    { value: '', label: t(locale, 'leaveHistory.allStatuses') },
    ...offeredHistoryStatuses(absenceOffered).map((value) => ({
      value,
      label: t(locale, value === 'ABSENT' ? 'leaveHistory.absentStatus' : `leave.${value}`),
    })),
  ];
}

function branchOptions(locale: Locale, branches: WorkspaceBranch[]): Option[] {
  return [
    { value: '', label: t(locale, 'leave.allBranches') },
    ...branches.map((branch) => ({
      value: branch.id,
      label: locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en,
    })),
  ];
}

export function LeaveHistoryFiltersForm({
  initial,
  absenceOffered,
  branches,
  onApply,
}: {
  initial: LeaveHistoryFilters;
  absenceOffered: boolean;
  branches: WorkspaceBranch[];
  onApply: (query: LeaveHistoryQuery) => void;
}) {
  const locale = useLocale();
  const [invalid, setInvalid] = useState(false);
  const form = useForm<LeaveHistoryFilters>({ defaultValues: initial });
  return (
    <form
      className="flex flex-wrap items-end gap-3 text-start"
      onSubmit={form.handleSubmit((values) => {
        const query = toHistoryQuery(values);
        setInvalid(query === null);
        if (query) onApply(query);
      })}
    >
      <div>
        <Label htmlFor="leave-history-from">{t(locale, 'leave.from')}</Label>
        <Input id="leave-history-from" type="date" {...form.register('from')} />
      </div>
      <div>
        <Label htmlFor="leave-history-to">{t(locale, 'leave.to')}</Label>
        <Input id="leave-history-to" type="date" {...form.register('to')} />
      </div>
      {filterSelect(
        'leave-history-type',
        t(locale, 'leave.type'),
        typeOptions(locale, absenceOffered),
        form.register('type'),
      )}
      {filterSelect(
        'leave-history-status',
        t(locale, 'leave.status'),
        statusOptions(locale, absenceOffered),
        form.register('status'),
      )}
      {filterSelect(
        'leave-history-branch',
        t(locale, 'leave.branch'),
        branchOptions(locale, branches),
        form.register('branchId'),
      )}
      <Button type="submit">{t(locale, 'leave.applyFilters')}</Button>
      {invalid ? <p role="alert">{t(locale, 'leaveHistory.rangeInvalid')}</p> : null}
    </form>
  );
}
