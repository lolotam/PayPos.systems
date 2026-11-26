'use client';
import {
  customerImportCommitAccepted,
  customerImportPreview,
  customerImportRowsPage,
  customerImportTemplate,
} from '@pospay/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { apiClient } from '@/shared/api/client';
import type { CustomerImportTargetScope } from '../model/customer-import-status';
import { uploadCustomerImportFile } from './upload-customer-import-file';
import { useCustomerImportRequest } from './use-customer-import-request';
import { useCustomerImportSelection } from './use-customer-import-selection';
import { useCustomerImportStatus } from './use-customer-import-status';

// نرفع رمز الحالة مع رفض الـ API كما تفعل بقية خطافات الاستيراد.
const refusal = (error: unknown, response: Response) => ({
  ...(error as object),
  status: response.status,
});

const isAbort = (error: unknown) =>
  (error instanceof Error && error.name === 'AbortError') ||
  (typeof DOMException !== 'undefined' &&
    error instanceof DOMException &&
    error.name === 'AbortError');

type PreviewAttempt = { token: number; file: File };
type RowsAttempt = { token: number; previewId: string; cursor: string };
type CommitAttempt = { token: number; previewId: string };

type Request = ReturnType<typeof useCustomerImportRequest>;
type Selection = ReturnType<typeof useCustomerImportSelection>;

/** قراءة قالب الاستيراد على مستوى الفرع إن كان المستخدم مقيّداً بفرع، وإلا على النشاط. */
async function fetchTemplate(
  { companyId, businessId, branchId }: CustomerImportTargetScope,
  signal: AbortSignal,
) {
  const header = { 'x-company-id': companyId };
  const result =
    branchId !== undefined
      ? await apiClient().GET('/v1/branches/{branchId}/customers/import/template', {
          params: { header, path: { branchId } },
          signal,
        })
      : await apiClient().GET('/v1/businesses/{businessId}/customers/import/template', {
          params: { header, path: { businessId } },
          signal,
        });
  if (result.error) throw refusal(result.error, result.response);
  return customerImportTemplate.parse(result.data);
}

async function postPreview(
  { companyId, businessId, branchId }: CustomerImportTargetScope,
  fileId: string,
  signal: AbortSignal,
) {
  const header = { 'x-company-id': companyId };
  const body = { file_id: fileId };
  const result =
    branchId !== undefined
      ? await apiClient().POST('/v1/branches/{branchId}/customers/import/previews', {
          params: { header, path: { branchId } },
          body,
          signal,
        })
      : await apiClient().POST('/v1/businesses/{businessId}/customers/import/previews', {
          params: { header, path: { businessId } },
          body,
          signal,
        });
  if (result.error) throw refusal(result.error, result.response);
  return customerImportPreview.parse(result.data);
}

async function fetchRows(
  { companyId, businessId, branchId }: CustomerImportTargetScope,
  { previewId, cursor }: RowsAttempt,
) {
  const header = { 'x-company-id': companyId };
  const query = { cursor, limit: 100 };
  const result =
    branchId !== undefined
      ? await apiClient().GET(
          '/v1/branches/{branchId}/customers/import/previews/{previewId}/rows',
          {
            params: { header, path: { branchId, previewId }, query },
          },
        )
      : await apiClient().GET(
          '/v1/businesses/{businessId}/customers/import/previews/{previewId}/rows',
          { params: { header, path: { businessId, previewId }, query } },
        );
  if (result.error) throw refusal(result.error, result.response);
  return customerImportRowsPage.parse(result.data);
}

async function postCommit(
  { companyId, businessId, branchId }: CustomerImportTargetScope,
  previewId: string,
) {
  const header = { 'x-company-id': companyId, 'Idempotency-Key': crypto.randomUUID() };
  const body = { preview_id: previewId };
  const result =
    branchId !== undefined
      ? await apiClient().POST('/v1/branches/{branchId}/customers/import/commits', {
          params: { header, path: { branchId } },
          body,
        })
      : await apiClient().POST('/v1/businesses/{businessId}/customers/import/commits', {
          params: { header, path: { businessId } },
          body,
        });
  if (result.error) throw refusal(result.error, result.response);
  return customerImportCommitAccepted.parse(result.data);
}

/** قراءة قالب الاستيراد مرة كل خمس دقائق على الأكثر. */
function useTemplateQuery(scope: CustomerImportTargetScope) {
  return useQuery({
    queryKey: [
      'customer-import-template',
      scope.companyId,
      scope.businessId,
      scope.branchId ?? null,
      scope.userId,
    ],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: ({ signal }) => fetchTemplate(scope, signal),
  });
}

/** رفع الملف ثم طلب المعاينة، وتجاهل النتيجة إن تغيّر الملف أو أُغلقت الصفحة أثناء الرفع. */
function usePreviewMutation(
  scope: CustomerImportTargetScope,
  request: Request,
  controllerRef: { current: AbortController | undefined },
) {
  return useMutation({
    mutationKey: [
      'customer-import-preview',
      scope.companyId,
      scope.businessId,
      scope.branchId ?? null,
      scope.userId,
    ],
    retry: false,
    mutationFn: async ({ token, file }: PreviewAttempt) => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      try {
        const fileId = await uploadCustomerImportFile({
          companyId: scope.companyId,
          businessId: scope.businessId,
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
          file,
          signal: controller.signal,
        });
        // الملف اتغير أثناء الرفع: المعاينة دي مش بتاعة المحاولة الجارية.
        if (token !== request.currentToken() || controller.signal.aborted) return undefined;
        return await postPreview(scope, fileId, controller.signal);
      } catch (error) {
        // الإلغاء بقرار منّا (تغيير الملف أو إغلاق الصفحة) مش خطأ يظهر للمستخدم.
        if (isAbort(error)) return undefined;
        throw error;
      }
    },
    onSuccess: (data, variables) => {
      if (data) request.acceptPreview(variables.token, data);
    },
  });
}

/** تحميل صفحة إضافية من الصفوف النظيفة. */
function useRowsMutation(scope: CustomerImportTargetScope, request: Request) {
  return useMutation({
    mutationKey: [
      'customer-import-rows',
      scope.companyId,
      scope.businessId,
      scope.branchId ?? null,
      scope.userId,
    ],
    retry: false,
    mutationFn: (attempt: RowsAttempt) => fetchRows(scope, attempt),
    onSuccess: (data, variables) => request.acceptRows(variables.token, variables.previewId, data),
  });
}

/** طلب الحفظ بمفتاح عدم تكرار جديد، وتذكّر المعاينة المقبولة للمتابعة بعد إعادة الفتح. */
function useCommitMutation(
  scope: CustomerImportTargetScope,
  request: Request,
  selection: Selection,
) {
  return useMutation({
    mutationKey: [
      'customer-import-commit',
      scope.companyId,
      scope.businessId,
      scope.branchId ?? null,
      scope.userId,
    ],
    retry: false,
    mutationFn: ({ previewId }: CommitAttempt) => postCommit(scope, previewId),
    onSuccess: (data, variables) => {
      if (variables.token !== request.currentToken()) return;
      selection.remember(data.preview_id);
    },
  });
}

/** يتابع الحالة بعد الحفظ، ويحرّر الاختيار المحفوظ عند نتيجة نهائية. */
function useCommitStatus(
  scope: CustomerImportTargetScope,
  selection: Selection,
  acceptedPreviewId?: string,
) {
  const previewId = acceptedPreviewId ?? selection.resumedPreviewId;
  const status = useCustomerImportStatus(scope, previewId);
  useEffect(() => {
    const outcome = status.data?.status;
    if (outcome === 'committed' || outcome === 'failed') selection.release();
  }, [status.data?.status, selection.release]);
  return status;
}

/** خطافات استيراد العملاء: القالب، والمعاينة مع الرفع، وصفوف المزيد، والحفظ. */
export function useCustomerImport(scope: CustomerImportTargetScope) {
  const uploadControllerRef = useRef<AbortController | undefined>(undefined);
  const request = useCustomerImportRequest();
  const selection = useCustomerImportSelection(scope);
  const template = useTemplateQuery(scope);
  const preview = usePreviewMutation(scope, request, uploadControllerRef);
  const rows = useRowsMutation(scope, request);
  const commit = useCommitMutation(scope, request, selection);
  const status = useCommitStatus(scope, selection, commit.data?.preview_id);

  // إغلاق الصفحة يوقف فحص الرفع الجاري فلا تستمر طلبات بعد الخروج.
  useEffect(() => () => uploadControllerRef.current?.abort(), []);

  const select = useCallback(
    (next?: File) => {
      uploadControllerRef.current?.abort();
      request.restart();
      preview.reset();
      rows.reset();
      commit.reset();
      selection.select(next);
    },
    [commit.reset, preview.reset, request.restart, rows.reset, selection.select],
  );

  return { template, preview, rows, commit, status, request, selection, select };
}
