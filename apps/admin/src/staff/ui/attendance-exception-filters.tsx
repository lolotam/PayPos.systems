'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
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
    <div className="flex flex-wrap items-end gap-3">
      <AttendanceActionBranch branches={branches} branchId={branchId} onBranch={onBranch} />
      <AttendanceExceptionTabs status={status} onStatus={onStatus} />
    </div>
  );
}
