'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { attendanceBoardQuery } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceBoardFilters({
  branches,
  branchId,
  date,
  today,
  onBranch,
  onDate,
}: {
  branches: WorkspaceBranch[];
  branchId: string;
  date: string;
  today: string | undefined;
  onBranch: (branchId: string) => void;
  onDate: (date: string | undefined) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1">
        <Label htmlFor="attendance-branch">{t(locale, 'attendanceBoard.branch')}</Label>
        <NativeSelect
          id="attendance-branch"
          value={branchId}
          onChange={(event) => onBranch(event.target.value)}
        >
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1">
        <Label htmlFor="attendance-date">{t(locale, 'attendanceBoard.date')}</Label>
        <Input
          id="attendance-date"
          type="date"
          value={date}
          max={today}
          disabled={!today}
          onChange={(event) => {
            const next = event.target.value;
            if (!next) {
              onDate(undefined);
              return;
            }
            if (attendanceBoardQuery.safeParse({ date: next }).success && today && next <= today)
              onDate(next);
          }}
        />
      </div>
      <Button variant="outline" onClick={() => onDate(undefined)}>
        {t(locale, 'attendanceBoard.today')}
      </Button>
    </div>
  );
}
