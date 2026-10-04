'use client';
import type { RequestEmployeeLeaveInput, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
export function LeaveBranchField({
  branches,
  register,
}: {
  branches: WorkspaceBranch[];
  register: UseFormRegister<RequestEmployeeLeaveInput>;
}) {
  const locale = useLocale();
  return (
    <>
      <Label htmlFor="leave-branch">{t(locale, 'leave.branch')}</Label>
      <NativeSelect id="leave-branch" {...register('branch_id')}>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {locale === 'ar' ? (b.name_ar ?? b.name_en) : b.name_en}
            {` (${b.effective_timezone})`}
          </option>
        ))}
      </NativeSelect>
      <p className="text-sm text-muted-foreground">{t(locale, 'leave.timezone')}</p>
    </>
  );
}
