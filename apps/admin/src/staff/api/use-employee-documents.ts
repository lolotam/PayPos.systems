'use client';
import {
  employeeDocument,
  employeeDocumentsView,
  fileDownload,
  type EmployeeDocumentFormValues,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import { uploadDocumentFile, type UploadPhase } from './upload-document-file';

export interface DocumentSubmission {
  file: File;
  values: EmployeeDocumentFormValues;
}

export function useEmployeeDocuments(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  const key = ['employee-documents', companyId, businessId, userId, employeeId];
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const view = useDocumentsView(companyId, businessId, userId, employeeId);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const record = useMutation({
    mutationKey: [...key, 'record'],
    retry: false,
    mutationFn: async ({ file, values }: DocumentSubmission) => {
      const fileId = await uploadDocumentFile({
        companyId,
        businessId,
        employeeId,
        file,
        onPhase: setPhase,
      });
      setPhase('recording');
      const result = await apiClient().POST(
        '/v1/businesses/{businessId}/employees/{employeeId}/documents',
        {
          params: {
            ...params,
            header: { ...params.header, 'Idempotency-Key': crypto.randomUUID() },
          },
          body: {
            type_code: values.type_code,
            file_id: fileId,
            expires_on: values.expires_on === '' ? null : values.expires_on,
          },
        },
      );
      if (result.error) throw result.error;
      return employeeDocument.parse(result.data);
    },
    onSettled: () => {
      setPhase('idle');
      return client.invalidateQueries({ queryKey: key });
    },
  });
  const open = useMutation({
    mutationKey: [...key, 'open'],
    retry: false,
    mutationFn: async (storageKey: string) => {
      const result = await apiClient().POST('/v1/files/download', {
        params: { header: params.header },
        body: { storage_key: storageKey },
      });
      if (result.error) throw result.error;
      return fileDownload.parse(result.data);
    },
    onSuccess: (download) => window.open(download.download_url, '_blank', 'noopener'),
  });
  return { view, record, open, phase };
}

function useDocumentsView(
  companyId: string,
  businessId: string,
  userId: string,
  employeeId: string,
) {
  const client = useQueryClient();
  const view = useQuery({
    queryKey: ['employee-documents', companyId, businessId, userId, employeeId],
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET(
        '/v1/businesses/{businessId}/employees/{employeeId}/documents',
        {
          params: { header: { 'x-company-id': companyId }, path: { businessId, employeeId } },
          signal,
        },
      );
      if (result.error) throw { ...result.error, status: result.response.status };
      return employeeDocumentsView.parse(result.data);
    },
  });
  // مفاتيح الوثائق لا تبقى في الذاكرة بعد إغلاق الموظف أو سحب الإذن.
  useEffect(() => {
    const key = ['employee-documents', companyId, businessId, userId, employeeId];
    return () => client.removeQueries({ queryKey: key });
  }, [client, companyId, businessId, userId, employeeId]);
  useEffect(() => {
    const status = (view.error as { status?: number } | null)?.status;
    if (view.isError && (status === 403 || status === 404))
      client.removeQueries({
        queryKey: ['employee-documents', companyId, businessId, userId, employeeId],
      });
  }, [client, companyId, businessId, userId, employeeId, view.isError, view.error]);
  return view;
}
