'use client';
import { attendanceMonthlyReportQuery, type WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export function AttendanceReportFilters({
  branches,
  branchId,
  month,
  onBranch,
  onMonth,
}: {
  branches: WorkspaceBranch[];
  branchId: string;
  month: string;
  onBranch: (branchId: string) => void;
  onMonth: (month: string) => void;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1">
        <Label htmlFor="report-month">{t(locale, 'attendanceReport.month')}</Label>
        <Input
          id="report-month"
          type="month"
          value={month}
          onChange={(event) => {
            const next = event.target.value;
            if (attendanceMonthlyReportQuery.safeParse({ month: next }).success) onMonth(next);
          }}
        />
      </div>
      <div className="grid gap-1">
        <Label htmlFor="report-branch">{t(locale, 'attendanceReport.branch')}</Label>
        <NativeSelect
          id="report-branch"
          value={branchId}
          onChange={(event) => onBranch(event.target.value)}
        >
          <option value="all">{t(locale, 'attendanceReport.allBranches')}</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {locale === 'ar' ? (branch.name_ar ?? branch.name_en) : branch.name_en}
            </option>
          ))}
        </NativeSelect>
      </div>
    </div>
  );
}
