'use client';
import type { LeaveHistoryQuery, WorkspaceBranch } from '@pospay/contracts';
import { useCallback, useState } from 'react';
import { defaultLeaveFilters, toHistoryQuery } from '../model/leave-history-filters';

export type LeaveReportState = {
  query: LeaveHistoryQuery;
  employeeId: string;
  run: number;
  cursor: string | undefined;
  heavy: boolean;
  setCursor: (cursor: string | undefined) => void;
  setHeavy: (heavy: boolean) => void;
  apply: (query: LeaveHistoryQuery) => void;
  chooseEmployee: (employeeId: string) => void;
};

const EMPTY_QUERY: LeaveHistoryQuery = {
  from: '2000-01-01',
  to: '2000-01-01',
  'types[]': [],
  'statuses[]': [],
  limit: 20,
};

/** أول قراءة بتفتح من أول يناير لحد النهارده في توقيت أول فرع. */
function firstQuery(branches: WorkspaceBranch[], timeZone: string | undefined): LeaveHistoryQuery {
  const zone = timeZone ?? branches[0]?.effective_timezone ?? 'UTC';
  return toHistoryQuery(defaultLeaveFilters(new Date(), zone)) ?? EMPTY_QUERY;
}

export function useLeaveReportState(
  branches: WorkspaceBranch[],
  timeZone: string | undefined,
): LeaveReportState {
  const [query, setQuery] = useState<LeaveHistoryQuery>(() => firstQuery(branches, timeZone));
  const [employeeId, setEmployeeId] = useState('');
  const [run, setRun] = useState(0);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [heavy, setHeavy] = useState(false);
  const restart = useCallback(() => {
    setCursor(undefined);
    setHeavy(false);
    setRun((value) => value + 1);
  }, []);
  const apply = useCallback(
    (next: LeaveHistoryQuery) => {
      setQuery(next);
      restart();
    },
    [restart],
  );
  const chooseEmployee = useCallback(
    (next: string) => {
      setEmployeeId(next);
      restart();
    },
    [restart],
  );
  return {
    query,
    employeeId,
    run,
    cursor,
    heavy,
    setCursor,
    setHeavy,
    apply,
    chooseEmployee,
  };
}
