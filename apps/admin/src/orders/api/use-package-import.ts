'use client';
import {
  packageImportCommitAccepted,
  packageImportPreviewAccepted,
  packageImportTemplate,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';
import { apiClient } from '@/shared/api/client';
import { uploadPackageImportFile } from './upload-package-import-file';
import { usePackageImportRequest } from './use-package-import-request';
import { usePackageImportSelection } from './use-package-import-selection';
import { usePackageImportStatus } from './use-package-import-status';

// نرفع رمز الحالة مع رفض الـ API كما تفعل بقية خطافات الاستيراد.
const refusal = (error: unknown, response: Response) => ({
  ...(error as object),
  status: response.status,
});

type PreviewAttempt = { token: number; file: File };
type CommitAttempt = { token: number; previewId: string };

type Scope = { companyId: string; businessId: string; userId: string };
type Request = ReturnType<typeof usePackageImportRequest>;
type Selection = ReturnType<typeof usePackageImportSelection>;

/** قراءة قالب الاستيراد مرة كل خمس دقائق على الأكثر. */
function useTemplateQuery({ companyId, businessId, userId }: Scope) {
  return useQuery({
    queryKey: ['package-import-template', companyId, businessId, userId],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/businesses/{businessId}/packages/import/template', {
        params: { header: { 'x-company-id': companyId }, path: { businessId } },
        signal,
      });
      if (result.error) throw refusal(result.error, result.response);
      return packageImportTemplate.parse(result.data);
    },
  });
}

/** رفع الملف ثم طلب المعاينة غير المتزامنة، وتجاهل النتيجة إن تغيّر الملف أثناء الرفع. */
function usePreviewMutation(
  { companyId, businessId, userId }: Scope,
  request: Request,
  selection: Selection,
) {
  return useMutation({
    mutationKey: ['package-import-preview', companyId, businessId, userId],
    retry: false,
    mutationFn: async ({ token, file }: PreviewAttempt) => {
      const fileId = await uploadPackageImportFile({ companyId, businessId, file });
      // الملف اتغير أثناء الرفع: المعاينة دي مش بتاعة المحاولة الجارية.
      if (token !== request.currentToken()) return undefined;
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/packages/import/previews',
        {
          params: { header: { 'x-company-id': companyId }, path: { businessId } },
          body: { file_id: fileId },
        },
      );
      if (result.error) throw refusal(result.error, result.response);
      return packageImportPreviewAccepted.parse(result.data);
    },
    onSuccess: (data, variables) => {
      if (!data || variables.token !== request.currentToken()) return;
      request.acceptPreview(variables.token, data.preview_id);
      selection.remember(data.preview_id);
    },
  });
}

/** طلب الحفظ بمفتاح عدم تكرار جديد، وتذكّر المعاينة المقبولة للمتابعة بعد إعادة الفتح. */
function useCommitMutation(
  { companyId, businessId, userId }: Scope,
  request: Request,
  selection: Selection,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['package-import-commit', companyId, businessId, userId],
    retry: false,
    mutationFn: async ({ previewId }: CommitAttempt) => {
      const result = await apiClient().POST('/v1/businesses/{businessId}/packages/import/commits', {
        params: {
          header: { 'x-company-id': companyId, 'Idempotency-Key': crypto.randomUUID() },
          path: { businessId },
        },
        body: { preview_id: previewId },
      });
      if (result.error) throw refusal(result.error, result.response);
      return packageImportCommitAccepted.parse(result.data);
    },
    onSuccess: (data, variables) => {
      if (variables.token !== request.currentToken()) return;
      request.acceptCommit(variables.token, data.preview_id);
      selection.remember(data.preview_id);
      void queryClient.invalidateQueries({
        queryKey: ['package-import-status', companyId, businessId, userId, data.preview_id],
      });
    },
  });
}

/** يحرّر الاختيار المحفوظ عند نتيجة نهائية أو معاينة فيها أخطاء، فلا تُستأنف عند إعادة الفتح. */
function useReleaseOnOutcome(
  status: ReturnType<typeof usePackageImportStatus>['data'],
  selection: Selection,
) {
  const outcome = status?.status;
  const dirty = status?.status === 'ready' && status.error_count > 0;
  useEffect(() => {
    if (outcome === 'committed' || outcome === 'failed' || dirty) selection.release();
  }, [outcome, dirty, selection.release]);
}

/** خطافات استيراد الباقات: القالب، والمعاينة مع الرفع، والحفظ، ومتابعة الحالة. */
export function usePackageImport(companyId: string, businessId: string, userId: string) {
  const scope = { companyId, businessId, userId };
  const request = usePackageImportRequest();
  const selection = usePackageImportSelection(companyId, businessId, userId);
  const template = useTemplateQuery(scope);
  const preview = usePreviewMutation(scope, request, selection);
  const commit = useCommitMutation(scope, request, selection);
  const previewId = request.previewId ?? selection.resumedPreviewId;
  const status = usePackageImportStatus(scope, previewId, request.commitAccepted);
  useReleaseOnOutcome(status.data, selection);

  const select = useCallback(
    (next?: File) => {
      request.restart();
      preview.reset();
      commit.reset();
      selection.select(next);
    },
    [commit.reset, preview.reset, request.restart, selection.select],
  );

  return { template, preview, commit, status, request, selection, select, previewId };
}
