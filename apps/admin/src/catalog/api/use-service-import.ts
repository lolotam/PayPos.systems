'use client';
import {
  serviceImportCommitAccepted,
  serviceImportPreview,
  serviceImportRowsPage,
  serviceImportTemplate,
} from '@pospay/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { apiClient } from '@/shared/api/client';
import { uploadServiceImportFile } from './upload-service-import-file';
import { useServiceImportRequest } from './use-service-import-request';
import { useServiceImportSelection } from './use-service-import-selection';
import { useServiceImportStatus } from './use-service-import-status';

// نرفع رمز الحالة مع رفض الـ API كما تفعل بقية خطافات الكتالوج.
const refusal = (error: unknown, response: Response) => ({
  ...(error as object),
  status: response.status,
});

type PreviewAttempt = { token: number; file: File };
type RowsAttempt = { token: number; previewId: string; cursor: string };
type CommitAttempt = { token: number; previewId: string };

type Scope = { companyId: string; businessId: string; userId: string };
type Request = ReturnType<typeof useServiceImportRequest>;
type Selection = ReturnType<typeof useServiceImportSelection>;

/** قراءة قالب الاستيراد مرة كل خمس دقائق على الأكثر. */
function useTemplateQuery({ companyId, businessId, userId }: Scope) {
  return useQuery({
    queryKey: ['service-import-template', companyId, businessId, userId],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/services/import/template', {
        params: { header: { 'x-company-id': companyId }, path: { businessId } },
        signal,
      });
      if (result.error) throw refusal(result.error, result.response);
      return serviceImportTemplate.parse(result.data);
    },
  });
}

/** رفع الملف ثم طلب المعاينة، وتجاهل النتيجة إن تغيّر الملف أثناء الرفع. */
function usePreviewMutation({ companyId, businessId, userId }: Scope, request: Request) {
  return useMutation({
    mutationKey: ['service-import-preview', companyId, businessId, userId],
    retry: false,
    mutationFn: async ({ token, file }: PreviewAttempt) => {
      const fileId = await uploadServiceImportFile({ companyId, businessId, file });
      // الملف اتغير أثناء الرفع: المتصفح تغيّر، فالمعاينة دي مش بتاعة المحاولة الجارية.
      if (token !== request.currentToken()) return undefined;
      const result = await apiClient().POST('/v1/businesses/{businessId}/services/import/previews', {
        params: { header: { 'x-company-id': companyId }, path: { businessId } },
        body: { file_id: fileId },
      });
      if (result.error) throw refusal(result.error, result.response);
      return serviceImportPreview.parse(result.data);
    },
    onSuccess: (data, variables) => {
      if (data) request.acceptPreview(variables.token, data);
    },
  });
}

/** تحميل صفحة إضافية من الصفوف النظيفة. */
function useRowsMutation({ companyId, businessId, userId }: Scope, request: Request) {
  return useMutation({
    mutationKey: ['service-import-rows', companyId, businessId, userId],
    retry: false,
    mutationFn: async ({ previewId, cursor }: RowsAttempt) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/services/import/previews/{previewId}/rows',
        {
          params: {
            header: { 'x-company-id': companyId },
            path: { businessId, previewId },
            query: { cursor, limit: 100 },
          },
        },
      );
      if (result.error) throw refusal(result.error, result.response);
      return serviceImportRowsPage.parse(result.data);
    },
    onSuccess: (data, variables) => request.acceptRows(variables.token, data),
  });
}

/** طلب الحفظ بمفتاح عدم تكرار جديد، وتذكّر المعاينة المقبولة للمتابعة بعد إعادة الفتح. */
function useCommitMutation(
  { companyId, businessId, userId }: Scope,
  request: Request,
  selection: Selection,
) {
  return useMutation({
    mutationKey: ['service-import-commit', companyId, businessId, userId],
    retry: false,
    mutationFn: async ({ previewId }: CommitAttempt) => {
      const result = await apiClient().POST('/v1/businesses/{businessId}/services/import/commits', {
        params: {
          header: { 'x-company-id': companyId, 'Idempotency-Key': crypto.randomUUID() },
          path: { businessId },
        },
        body: { preview_id: previewId },
      });
      if (result.error) throw refusal(result.error, result.response);
      return serviceImportCommitAccepted.parse(result.data);
    },
    onSuccess: (data, variables) => {
      if (variables.token !== request.currentToken()) return;
      selection.remember(data.preview_id);
    },
  });
}

/** يتابع الحالة بعد الحفظ، ويحرّر الاختيار المحفوظ عند نتيجة نهائية. */
function useCommitStatus(scope: Scope, selection: Selection, acceptedPreviewId?: string) {
  const previewId = acceptedPreviewId ?? selection.resumedPreviewId;
  const status = useServiceImportStatus(scope.companyId, scope.businessId, scope.userId, previewId);
  useEffect(() => {
    const outcome = status.data?.status;
    if (outcome === 'committed' || outcome === 'failed') selection.release();
  }, [status.data?.status, selection.release]);
  return status;
}

/** خطافات استيراد الخدمات: القالب، والمعاينة مع الرفع، وصفوف المزيد، والحفظ. */
export function useServiceImport(companyId: string, businessId: string, userId: string) {
  const scope = { companyId, businessId, userId };
  const request = useServiceImportRequest();
  const selection = useServiceImportSelection(companyId, businessId, userId);
  const template = useTemplateQuery(scope);
  const preview = usePreviewMutation(scope, request);
  const rows = useRowsMutation(scope, request);
  const commit = useCommitMutation(scope, request, selection);
  const status = useCommitStatus(scope, selection, commit.data?.preview_id);

  const select = useCallback(
    (next?: File) => {
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
