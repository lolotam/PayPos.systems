'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
export function AttendanceActionBranch({
  branches,
  branchId,
  onBranch,
}: {
  branches: WorkspaceBranch[];
  branchId: string;
  onBranch: (id: string) => void;
}) {
  const locale = useLocale();
  return (
    <div className="grid gap-1">
      <Label htmlFor="attendance-action-branch">{t(locale, 'attendanceBoard.branch')}</Label>
      <NativeSelect
        id="attendance-action-branch"
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
  );
}
