'use client';
import { leaveInboxQuery, type LeaveInboxQuery, type WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
export function LeaveInboxFilters({
  branches,
  onApply,
}: {
  branches: WorkspaceBranch[];
  onApply: (query: LeaveInboxQuery) => void;
}) {
  const locale = useLocale();
  const [invalid, setInvalid] = useState(false);
  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const parsed = leaveInboxQuery.safeParse(
          Object.fromEntries([...values.entries()].filter(([, value]) => value !== '')),
        );
        setInvalid(!parsed.success);
        if (parsed.success) onApply(parsed.data);
      }}
    >
      <div>
        <Label htmlFor="inbox-branch">{t(locale, 'leave.branch')}</Label>
        <NativeSelect id="inbox-branch" name="branch_id">
          <option value="">{t(locale, 'leave.allBranches')}</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {locale === 'ar' ? (b.name_ar ?? b.name_en) : b.name_en}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div>
        <Label htmlFor="inbox-from">{t(locale, 'leave.from')}</Label>
        <Input id="inbox-from" type="date" name="from" />
      </div>
      <div>
        <Label htmlFor="inbox-to">{t(locale, 'leave.to')}</Label>
        <Input id="inbox-to" type="date" name="to" />
      </div>
      <Button type="submit">{t(locale, 'leave.applyFilters')}</Button>
      {invalid ? <p role="alert">{t(locale, 'errors.LEAVE_PERIOD_INVALID')}</p> : null}
    </form>
  );
}
