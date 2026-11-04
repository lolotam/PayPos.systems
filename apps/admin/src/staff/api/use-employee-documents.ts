'use client';
import {
  employeeDocument,
  employeeDocumentsView,
  fileDownload,
  type EmployeeDocumentFormValues,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const scope = useMemo(() => ({}), [companyId, businessId, userId, employeeId]);
  const { current, active } = useDocumentAccess(scope, view);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const recordContext = { companyId, businessId, employeeId, active, onPhase: setPhase };
  const record = useMutation({
    mutationKey: [...key, 'record'],
    retry: false,
    onMutate: () => ({ scope, key }),
    mutationFn: (submission: DocumentSubmission) =>
      recordEmployeeDocument(submission, recordContext),
    onSettled: (_data, _error, _variables, context) => {
      if (context?.scope === current.current.scope && active()) setPhase('idle');
      return context ? client.invalidateQueries({ queryKey: context.key }) : undefined;
    },
  });
  const open = useMutation({
    mutationKey: [...key, 'open'],
    retry: false,
    mutationFn: async (storageKey: string) => {
      if (!active()) return undefined;
      const result = await apiClient().POST('/v1/files/download', {
        params: { header: params.header },
        body: { storage_key: storageKey },
      });
      if (result.error) throw result.error;
      return { download: fileDownload.parse(result.data), scope };
    },
    onSuccess: (result) => {
      if (result && result.scope === current.current.scope && active())
        window.open(result.download.download_url, '_blank', 'noopener');
    },
  });
  const resetRecord = record.reset;
  const resetOpen = open.reset;
  useEffect(() => {
    setPhase('idle');
    resetRecord();
    resetOpen();
  }, [scope, resetRecord, resetOpen]);
  return { view, record, open, phase };
}

function useDocumentAccess(scope: object, view: ReturnType<typeof useDocumentsView>) {
  const current = useRef({ scope, mounted: true, readable: false, writable: false });
  current.current.scope = scope;
  current.current.readable = view.isFetchedAfterMount && !view.isError && !!view.data;
  current.current.writable = current.current.readable && !!view.data?.can_manage;
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  const active = (write = false) =>
    current.current.mounted &&
    current.current.scope === scope &&
    (write ? current.current.writable : current.current.readable);
  return { current, active };
}

type DocumentRecordContext = {
  companyId: string;
  businessId: string;
  employeeId: string;
  active: (write?: boolean) => boolean;
  onPhase: (phase: UploadPhase) => void;
};

async function recordEmployeeDocument(
  { file, values }: DocumentSubmission,
  { companyId, businessId, employeeId, active, onPhase }: DocumentRecordContext,
) {
  if (!active(true)) return undefined;
  const fileId = await uploadDocumentFile({
    companyId,
    businessId,
    employeeId,
    file,
    onPhase: (next) => {
      if (active(true)) onPhase(next);
    },
  });
  if (!active(true)) return undefined;
  onPhase('recording');
  const result = await apiClient().POST(
    '/v1/businesses/{businessId}/employees/{employeeId}/documents',
    {
      params: {
        path: { businessId, employeeId },
        header: { 'x-company-id': companyId, 'Idempotency-Key': crypto.randomUUID() },
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
