'use client';
import type { LeaveHistoryQuery, WorkspaceBranch } from '@pospay/contracts';
import { useState } from 'react';
import { defaultLeaveFilters, toHistoryQuery } from '../model/leave-history-filters';
import { useLeaveScopeEviction } from './leave-query-scope';
import { useLeave } from './use-leave';
import { useLeaveHistory } from './use-leave-history';

function denied(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === 403 || status === 404;
}

function useLeaveTabState(zone: string) {
  const [initialFilters] = useState(() => defaultLeaveFilters(new Date(), zone));
  const [applied, setApplied] = useState<LeaveHistoryQuery | undefined>(
    () => toHistoryQuery(initialFilters) ?? undefined,
  );
  const [historyCursor, setHistoryCursor] = useState<string>();
  const [openCursor, setOpenCursor] = useState<string>();
  const applyFilters = (query: LeaveHistoryQuery) => {
    setApplied(query);
    setHistoryCursor(undefined);
  };
  return {
    applied,
    applyFilters,
    initialFilters,
    openCursor,
    setOpenCursor,
    historyCursor,
    setHistoryCursor,
  };
}

export function useEmployeeLeaveTab({
  companyId,
  businessId,
  userId,
  employeeId,
  branches,
  timeZone,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
  branches: WorkspaceBranch[];
  timeZone?: string | undefined;
}) {
  const zone = timeZone ?? branches[0]?.effective_timezone ?? 'UTC';
  const state = useLeaveTabState(zone);
  const history = useLeaveHistory(
    companyId,
    businessId,
    userId,
    employeeId,
    state.applied,
    state.historyCursor,
  );
  const { open, save, cancel } = useLeave(
    companyId,
    businessId,
    userId,
    employeeId,
    state.openCursor,
    history.isSuccess ? history.data.as_of : undefined,
    history.isSuccess || history.isError,
  );
  useLeaveScopeEviction(companyId, businessId, userId, employeeId, denied(open.error));
  return { open, history, save, cancel, ...state };
}
