import { leaveHistoryQuery, type LeaveHistoryQuery } from '@pospay/contracts';
import { localDate } from '@pospay/i18n';

type HistoryType = 'ANNUAL' | 'SICK' | 'UNPAID' | 'OTHER' | 'UNEXCUSED_ABSENCE';
type HistoryStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'ABSENT';
export type LeaveHistoryFilters = {
  from: string;
  to: string;
  type: string;
  status: string;
  branchId: string;
};

export function defaultLeaveFilters(now: Date, timeZone: string): LeaveHistoryFilters {
  const today = localDate(now, timeZone);
  return {
    from: `${today.slice(0, 4)}-01-01`,
    to: today,
    type: '',
    status: '',
    branchId: '',
  };
}

export function toHistoryQuery(values: LeaveHistoryFilters): LeaveHistoryQuery | null {
  const parsed = leaveHistoryQuery.safeParse({
    from: values.from,
    to: values.to,
    ...(values.type ? { 'types[]': [values.type] } : {}),
    ...(values.status ? { 'statuses[]': [values.status] } : {}),
    ...(values.branchId ? { branch_id: values.branchId } : {}),
    limit: 20,
  });
  return parsed.success ? parsed.data : null;
}

export function fromHistoryQuery(query: LeaveHistoryQuery): LeaveHistoryFilters {
  return {
    from: query.from,
    to: query.to,
    type: query['types[]'][0] ?? '',
    status: query['statuses[]'][0] ?? '',
    branchId: query.branch_id ?? '',
  };
}

export function offeredHistoryTypes(absenceOffered: boolean): HistoryType[] {
  return [
    'ANNUAL',
    'SICK',
    'UNPAID',
    'OTHER',
    ...(absenceOffered ? (['UNEXCUSED_ABSENCE'] as const) : []),
  ];
}

export function offeredHistoryStatuses(absenceOffered: boolean): HistoryStatus[] {
  return [
    'PENDING',
    'APPROVED',
    'REJECTED',
    'CANCELLED',
    ...(absenceOffered ? (['ABSENT'] as const) : []),
  ];
}

export function offeredAbsence(absenceBranchIds: string[]): boolean {
  return absenceBranchIds.length > 0;
}
