'use client';
import type { WorkspaceBranch } from '@pospay/contracts';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
  isReportRequired,
  reportLastTaken,
  reportPage,
  reportViewState,
  toReportBody,
  type LeaveReportBody,
  type LeaveReportScope,
  type LeaveReportView,
} from '../model/leave-report-view';
import {
  leaveReportPostedKey,
  postLeaveReport,
  REPORT_POSTED_GC_MS,
  useLeaveReportJob,
  useLeaveReportPosted,
} from './use-leave-report-job';
import { useLeaveReportState, type LeaveReportState } from './use-leave-report-state';
import { useLeaveReportSync } from './use-leave-report-sync';

type ReportSync = ReturnType<typeof useLeaveReportSync>;
type ReportJob = ReturnType<typeof useLeaveReportJob>;
type ReportPosted = ReturnType<typeof useLeaveReportPosted>;

/** الطلب اللي بدأ أو خلص بيمنع طلب تاني، أما مدخل المراقب الفاضي (معلق بلا بيانات) فمش بيمنع. */
function isPostStarted(client: QueryClient, postedKey: QueryKey): boolean {
  const posted = client.getQueryState(postedKey);
  return posted !== undefined && (posted.fetchStatus !== 'idle' || posted.status !== 'pending');
}

/**
 * طلب واحد لكل تشغيل: القيد في كاش الاستعلامات مش في الشاشة، فإعادة فتح الشاشة بتلاقي نفس التشغيل ما تطلبش تاني.
 */
function useLeaveReportRequest(
  state: LeaveReportState,
  sync: ReportSync,
  client: QueryClient,
  scope: LeaveReportScope,
  postedKey: QueryKey,
  body: LeaveReportBody,
) {
  useEffect(() => {
    if (!sync.isError || !isReportRequired(sync.error)) return;
    state.setHeavy(true);
    if (isPostStarted(client, postedKey)) return;
    const request = client.fetchQuery({
      queryKey: postedKey,
      queryFn: () => postLeaveReport(scope, body),
      staleTime: Infinity,
      retry: false,
      gcTime: REPORT_POSTED_GC_MS,
    });
    // الرفض مش مُبلَع: المراقب على نفس المفتاح بيعرض الخطأ من هناك، والـ catch ده بيمنع rejection مش مقفوض.
    void request.catch(() => undefined);
  }, [body, client, postedKey, scope, state.setHeavy, sync.error, sync.isError]);
}

/** استعلامات التقرير بتتنضف لما الشاشة تقفل، عدا الطلب المنشور: هو اللي بيمنع طلب تاني بعد إعادة الفتح. */
function useLeaveReportEviction(client: QueryClient, scope: LeaveReportScope) {
  useEffect(
    () => () => {
      client.removeQueries({
        queryKey: ['leave-report', scope.companyId, scope.businessId, scope.userId],
        predicate: (query) => query.queryKey[4] !== 'posted',
      });
    },
    [client, scope.businessId, scope.companyId, scope.userId],
  );
}

function buildView(
  state: LeaveReportState,
  sync: ReportSync,
  job: ReportJob,
  posted: ReportPosted,
): LeaveReportView {
  const reportId = posted.data?.report_id;
  const jobData = reportId === undefined ? undefined : job.result.data;
  const jobError = reportId === undefined ? undefined : job.result.error;
  const view = reportViewState({
    syncPending: sync.isPending,
    syncError: sync.error,
    postError: posted.error,
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
      sync.isFetching || (reportId !== undefined && job.result.isFetching) || posted.isFetching,
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
  const scope = useMemo(() => ({ companyId, businessId, userId }), [companyId, businessId, userId]);
  const state = useLeaveReportState(branches, timeZone);
  const client = useQueryClient();
  const sync = useLeaveReportSync({
    scope,
    query: state.query,
    employeeId: state.employeeId,
    run: state.run,
    cursor: state.heavy ? undefined : state.cursor,
  });
  const body = useMemo(() => toReportBody(state.query), [state.query]);
  const postedKey = useMemo(
    () => leaveReportPostedKey(scope, state.run, body),
    [body, scope, state.run],
  );
  const posted = useLeaveReportPosted(postedKey);
  const job = useLeaveReportJob(scope, posted.data?.report_id, state.cursor, state.query.limit);
  useLeaveReportRequest(state, sync, client, scope, postedKey, body);
  useLeaveReportEviction(client, scope);
  return buildView(state, sync, job, posted);
}
