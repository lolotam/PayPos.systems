'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { FilterRow } from '@/shared/ui/filter-row';
import { AttendanceActionBranch } from './attendance-action-branch';
import { AttendanceExceptionTabs } from './attendance-exception-tabs';

export function AttendanceExceptionFilters({
  branches,
  branchId,
  status,
  onBranch,
  onStatus,
}: {
  branches: WorkspaceBranch[];
  branchId: string;
  status: 'OPEN' | 'RESOLVED';
  onBranch: (id: string) => void;
  onStatus: (status: 'OPEN' | 'RESOLVED') => void;
}) {
  return (
    <FilterRow>
      <AttendanceActionBranch branches={branches} branchId={branchId} onBranch={onBranch} />
      <AttendanceExceptionTabs status={status} onStatus={onStatus} />
    </FilterRow>
  );
}
