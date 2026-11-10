'use client';
import {
  employeeDocument,
  employeeDocumentsView,
  type EmployeeDocumentFormValues,
} from '@pospay/contracts';
import {
  notifyManager,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { apiClient } from '@/shared/api/client';
import {
  beginOpen,
  readReadyData,
  releaseUnconsumed,
  settle,
  watchOpen,
  type OpenAccess,
  type OpenContext,
  type OpenLife,
} from './employee-document-open';
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
  const key = useMemo(
    () => ['employee-documents', companyId, businessId, userId, employeeId],
    [companyId, businessId, userId, employeeId],
  );
  const params = { header: { 'x-company-id': companyId }, path: { businessId, employeeId } };
  const view = useDocumentsView(companyId, businessId, userId, employeeId);
  const scope = useDocumentScope(key);
  const { current, begin, active } = useDocumentAccess(scope, key);
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const recordContext = { companyId, businessId, employeeId, begin, active, onPhase: setPhase };
  const record = useMutation({
    mutationKey: [...key, 'record'],
    retry: false,
    onMutate: () => ({ scope, key }),
    mutationFn: (submission: DocumentSubmission) =>
      recordEmployeeDocument(submission, recordContext),
    onSettled: (_data, _error, _variables, context) => {
      if (context?.scope === current.current.scope && current.current.mounted) setPhase('idle');
      return context ? client.invalidateQueries({ queryKey: context.key }) : undefined;
    },
  });
  const open = useDocumentOpen(client, key, params.header, scope, { begin, active }, view);
  const resetRecord = record.reset;
  const resetOpen = open.reset;
  useEffect(() => {
    setPhase('idle');
    resetRecord();
    resetOpen();
  }, [scope, resetRecord, resetOpen]);
  const saved = record.data;
  const data = saved && active(saved.operation) ? saved.document : undefined;
  return {
    view,
    get documents() {
      return open.documents();
    },
    record: { ...record, data },
    open,
    phase,
  };
}

function useDocumentScope(key: string[]) {
  const identity = JSON.stringify(key);
  const [holder, setHolder] = useState<{ identity: string; scope: object }>({
    identity,
    scope: {},
  });
  if (holder.identity !== identity) {
    const next = { identity, scope: {} };
    setHolder(next);
    return next.scope;
  }
  return holder.scope;
}

type DocumentOperation = {
  scope: object;
  kind: 'read' | 'write';
  readEpoch: number;
  writeEpoch: number;
};

type DocumentAccessState = {
  scope: object;
  mounted: boolean;
  readable: boolean;
  writable: boolean;
  readEpoch: number;
  writeEpoch: number;
};

function syncDocumentAccess(state: DocumentAccessState, client: QueryClient, key: string[]) {
  const query = client.getQueryState<ReturnType<typeof employeeDocumentsView.parse>>(key);
  const readable = query?.status === 'success' && !!query.data;
  const writable = readable && !!query?.data?.can_manage;
  if (state.readable && !readable) state.readEpoch += 1;
  if (state.writable && !writable) state.writeEpoch += 1;
  state.readable = readable;
  state.writable = writable;
}

function useDocumentAccess(scope: object, key: string[]) {
  const client = useQueryClient();
  const current = useRef<DocumentAccessState>({
    scope,
    mounted: true,
    readable: false,
    writable: false,
    readEpoch: 0,
    writeEpoch: 0,
  });
  current.current.scope = scope;
  syncDocumentAccess(current.current, client, key);
  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);
  useEffect(
    () =>
      client.getQueryCache().subscribe(({ query }) => {
        if (current.current.scope !== scope || query.queryKey.length !== key.length) return;
        if (query.queryKey.some((value: unknown, index: number) => value !== key[index])) return;
        syncDocumentAccess(current.current, client, key);
      }),
    [client, key, scope],
  );
  const begin = (kind: 'read' | 'write' = 'read'): DocumentOperation => ({
    scope,
    kind,
    readEpoch: current.current.readEpoch,
    writeEpoch: current.current.writeEpoch,
  });
  const active = (operation: DocumentOperation) => {
    if (current.current.scope !== scope) return false;
    syncDocumentAccess(current.current, client, key);
    return (
      current.current.mounted &&
      current.current.scope === operation.scope &&
      current.current.readEpoch === operation.readEpoch &&
      (operation.kind === 'write'
        ? current.current.writable && current.current.writeEpoch === operation.writeEpoch
        : current.current.readable)
    );
  };
  return { current, begin, active };
}

function openContext(
  client: QueryClient,
  key: string[],
  header: { 'x-company-id': string },
  access: OpenAccess,
  show: OpenContext['show'],
  scope: object,
): OpenContext {
  return {
    scope,
    client,
    key,
    header,
    life: { alive: false, access, query: undefined, scope, client, key },
    registry: new Map(),
    pending: null,
    opening: null,
    generation: 0,
    show,
    schedule: notifyManager.schedule,
  };
}
function useDocumentOpen(
  client: QueryClient,
  key: string[],
  header: { 'x-company-id': string },
  scope: object,
  access: OpenAccess,
  observer: ReturnType<typeof useDocumentsView>,
) {
  const accessNow = useRef(access);
  accessNow.current = access;
  const binding = useMemo(() => ({ scope, client, key }), [scope, client, key]);
  const [life, setLife] = useState<OpenLife | null>(null);
  const [, refresh] = useState(0);
  const [ui, setUi] = useState<{ error?: Parameters<OpenContext['show']>[0]; opening: boolean }>({
    opening: false,
  });
  const show = (error?: Parameters<OpenContext['show']>[0], opening = false) =>
    setUi(error === undefined ? { opening } : { error, opening });
  const board = useRef<OpenContext | null>(null);
  if (!board.current) {
    board.current = openContext(client, key, header, access, show, scope);
  }
  const ctx = board.current;
  ctx.show = show;
  ctx.header = header;
  ctx.key = key;
  ctx.client = client;
  ctx.scope = scope;
  useEffect(() => {
    const next = { ...binding, alive: true, access: accessNow.current, query: undefined };
    ctx.life = next;
    const stop = watchOpen(ctx, () => refresh((revision) => revision + 1));
    setLife(next);
    setUi({ opening: false });
    return () => {
      next.alive = false;
      stop();
    };
  }, [ctx, binding]);
  const mutation = useMutation({
    mutationKey: [...key, 'open'],
    retry: false,
    mutationFn: (token: object) => settle(token, ctx),
  });
  const mutate = (storageKey: string) => {
    if (!life?.alive) return;
    beginOpen(storageKey, ctx, life, (token) => {
      mutation.mutate(token, { onSettled: () => releaseUnconsumed(token, ctx) });
    });
  };
  return {
    ...mutation,
    documents: () => readReadyData(ctx, life, observer),
    mutate,
    error: ui.error,
    isPending: ui.opening,
    isError: ui.error !== undefined,
  };
}

type DocumentRecordContext = {
  companyId: string;
  businessId: string;
  employeeId: string;
  begin: (kind?: 'read' | 'write') => DocumentOperation;
  active: (operation: DocumentOperation) => boolean;
  onPhase: (phase: UploadPhase) => void;
};

async function recordEmployeeDocument(
  { file, values }: DocumentSubmission,
  { companyId, businessId, employeeId, begin, active, onPhase }: DocumentRecordContext,
) {
  const operation = begin('write');
  if (!active(operation)) return undefined;
  const fileId = await uploadDocumentFile({
    companyId,
    businessId,
    employeeId,
    file,
    onPhase: (next) => {
      if (active(operation)) onPhase(next);
    },
  });
  if (!active(operation)) return undefined;
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
  if (!active(operation)) return undefined;
  return { document: employeeDocument.parse(result.data), operation };
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
