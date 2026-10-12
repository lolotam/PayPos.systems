'use client';
import type { AttendanceChangeListQuery, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { AttendanceActionBranch } from './attendance-action-branch';
type Props = {
  branches: WorkspaceBranch[];
  branchId: string;
  status: AttendanceChangeListQuery['status'];
  canCreate: boolean;
  allowAllBranches: boolean;
  onBranch: (id: string) => void;
  onStatus: (status: AttendanceChangeListQuery['status']) => void;
  onManual: () => void;
};
export function AttendanceRequestFilters({
  branches,
  branchId,
  status,
  canCreate,
  allowAllBranches,
  onBranch,
  onStatus,
  onManual,
}: Props) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <AttendanceActionBranch
        branches={branches}
        branchId={branchId}
        onBranch={onBranch}
        allowAllBranches={allowAllBranches}
      />
      <div className="grid gap-1">
        <Label htmlFor="attendance-request-status">{t(locale, 'attendanceBoard.status')}</Label>
        <NativeSelect
          id="attendance-request-status"
          value={status ?? ''}
          onChange={(event) =>
            onStatus(
              event.target.value
                ? (event.target.value as AttendanceChangeListQuery['status'])
                : undefined,
            )
          }
        >
          <option value="">{t(locale, 'attendanceActions.all')}</option>
          {(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const).map((value) => (
            <option key={value} value={value}>
              {t(locale, `attendanceActions.${value}`)}
            </option>
          ))}
        </NativeSelect>
      </div>
      {canCreate ? (
        <Button onClick={onManual}>{t(locale, 'attendanceActions.manual')}</Button>
      ) : null}
    </div>
  );
}
