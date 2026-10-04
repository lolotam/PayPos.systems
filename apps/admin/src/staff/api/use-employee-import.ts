'use client';
import {
  employeeImportCommitAccepted,
  employeeImportPreview,
  employeeImportTemplate,
} from '@pospay/contracts';
import { useMutation, useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';
import { uploadImportFile } from './upload-import-file';
import { useState } from 'react';
import { useEmployeeImportStatus } from './use-employee-import-status';

// نرفع رمز الحالة مع رفض الـ API كما تفعل بقية خطافات الموظفين.
const refusal = (error: unknown, response: Response) => ({
  ...(error as object),
  status: response.status,
});

/** خطافات استيراد الموظفين: القالب، المعاينة (مع الرفع)، والحفظ. */
export function useEmployeeImport(companyId: string, businessId: string, userId: string) {
  const header = { 'x-company-id': companyId };
  const [requestedPreview, setRequestedPreview] = useState<string>();

  const template = useQuery({
    queryKey: ['employee-import-template', companyId, businessId, userId],
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/import/template',
        { params: { header, path: { businessId } }, signal },
      );
      if (result.error) throw refusal(result.error, result.response);
      return employeeImportTemplate.parse(result.data);
    },
  });

  const preview = useMutation({
    mutationKey: ['employee-import-preview', companyId, businessId, userId],
    retry: false,
    mutationFn: async (file: File) => {
      const fileId = await uploadImportFile({ companyId, businessId, file });
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/import/previews',
        { params: { header, path: { businessId } }, body: { file_id: fileId } },
      );
      if (result.error) throw refusal(result.error, result.response);
      return employeeImportPreview.parse(result.data);
    },
  });

  const commit = useMutation({
    mutationKey: ['employee-import-commit', companyId, businessId, userId],
    retry: false,
    mutationFn: async (previewId: string) => {
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/import/commits',
        {
          params: {
            header: { ...header, 'Idempotency-Key': crypto.randomUUID() },
            path: { businessId },
          },
          body: { preview_id: previewId },
        },
      );
      if (result.error) throw refusal(result.error, result.response);
      return employeeImportCommitAccepted.parse(result.data);
    },
    onSuccess: (accepted) => setRequestedPreview(accepted.preview_id),
  });

  const status = useEmployeeImportStatus(companyId, businessId, userId, requestedPreview);

  return { template, preview, commit, status };
}
