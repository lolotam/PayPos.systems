'use client';
import type { AttendanceChangeListQuery, WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { FilterField } from '@/shared/ui/filter-field';
import { FilterRow } from '@/shared/ui/filter-row';
import { AttendanceActionBranch } from './attendance-action-branch';
type Props = {
  branches: WorkspaceBranch[];
  branchId: string;
  status: AttendanceChangeListQuery['status'];
  allowAllBranches: boolean;
  onBranch: (id: string) => void;
  onStatus: (status: AttendanceChangeListQuery['status']) => void;
};
export function AttendanceRequestFilters({
  branches,
  branchId,
  status,
  allowAllBranches,
  onBranch,
  onStatus,
}: Props) {
  const locale = useLocale();
  return (
    <FilterRow>
      <AttendanceActionBranch
        branches={branches}
        branchId={branchId}
        onBranch={onBranch}
        allowAllBranches={allowAllBranches}
      />
      <FilterField>
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
      </FilterField>
    </FilterRow>
  );
}
