'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import {
  isReportRequired,
  reportLastTaken,
  reportPage,
  reportViewState,
  toReportBody,
  type LeaveReportScope,
  type LeaveReportView,
} from '../model/leave-report-view';
import { useLeaveReportJob } from './use-leave-report-job';
import {
  currentOutcome,
  useLeaveReportState,
  type LeaveReportState,
} from './use-leave-report-state';
import { useLeaveReportSync } from './use-leave-report-sync';

type ReportSync = ReturnType<typeof useLeaveReportSync>;
type ReportJob = ReturnType<typeof useLeaveReportJob>;

/**
 * طلب واحد لكل تشغيل: التشغيل الجاي بياخد رقم جديد، والطلب بيتشال بعد أول مرة عشان تكرار القراءة ما يعملش تقرير تاني.
 */
function useLeaveReportRequest(state: LeaveReportState, sync: ReportSync, job: ReportJob) {
  const postedRun = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!sync.isError || !isReportRequired(sync.error)) return;
    state.setHeavy(true);
    if (postedRun.current === state.run) return;
    postedRun.current = state.run;
    job.request.mutate(toReportBody(state.query), {
      onSuccess: (accepted) => state.setOutcome({ run: state.run, reportId: accepted.report_id }),
      onError: (error) => state.setOutcome({ run: state.run, error }),
    });
  }, [
    job.request.mutate,
    state.query,
    state.run,
    state.setHeavy,
    state.setOutcome,
    sync.error,
    sync.isError,
  ]);
}

/** استعلامات التقرير بتتنضف لما الشاشة تقفل، عشان ما تتلخبطش بطلب جديد على نفس النطاق. */
function useLeaveReportEviction(client: QueryClient, scope: LeaveReportScope) {
  useEffect(
    () => () => {
      client.removeQueries({
        queryKey: ['leave-report', scope.companyId, scope.businessId, scope.userId],
      });
    },
    [client, scope.businessId, scope.companyId, scope.userId],
  );
}

function buildView(state: LeaveReportState, sync: ReportSync, job: ReportJob): LeaveReportView {
  const outcome = currentOutcome(state);
  const reportId = outcome?.reportId;
  const jobData = reportId === undefined ? undefined : job.result.data;
  const jobError = reportId === undefined ? undefined : job.result.error;
  const view = reportViewState({
    syncPending: sync.isPending,
    syncError: sync.error,
    postError: outcome?.error,
    jobError,
    jobStatus: jobData,
  });
  const page = reportPage(sync.data, jobData);
  const lastTaken = reportLastTaken(sync.data, state.employeeId);
  return {
    status: view.status,
    ...(page === undefined ? {} : { page }),
    ...(view.error === undefined ? {} : { error: view.error }),
    ...(lastTaken === undefined ? {} : { lastTaken }),
    fetching:
      sync.isFetching || (reportId !== undefined && job.result.isFetching) || job.request.isPending,
    cursor: state.cursor,
    setCursor: state.setCursor,
    apply: state.apply,
    chooseEmployee: state.chooseEmployee,
    query: state.query,
    employeeId: state.employeeId,
  };
}

export function useLeaveReport({
  companyId,
  businessId,
  userId,
  branches,
  timeZone,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  branches: WorkspaceBranch[];
  timeZone?: string | undefined;
}): LeaveReportView {
  const scope: LeaveReportScope = { companyId, businessId, userId };
  const state = useLeaveReportState(branches, timeZone);
  const client = useQueryClient();
  const sync = useLeaveReportSync({
    scope,
    query: state.query,
    employeeId: state.employeeId,
    run: state.run,
    cursor: state.heavy ? undefined : state.cursor,
  });
  const job = useLeaveReportJob(
    scope,
    currentOutcome(state)?.reportId,
    state.cursor,
    state.query.limit,
  );
  useLeaveReportRequest(state, sync, job);
  useLeaveReportEviction(client, scope);
  return buildView(state, sync, job);
}
