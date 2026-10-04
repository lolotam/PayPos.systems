'use client';
import {
  documentType,
  documentTypeList,
  type CreateDocumentTypeInput,
  type DocumentType,
} from '@pospay/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export type DocumentTypeChange =
  | { kind: 'create'; input: CreateDocumentTypeInput }
  | { kind: 'update'; type: DocumentType; input: CreateDocumentTypeInput }
  | { kind: 'deactivate' | 'reactivate'; type: DocumentType };

const terms = (input: CreateDocumentTypeInput) => ({ ...input, name_ar: input.name_ar ?? null });

async function send(companyId: string, change: DocumentTypeChange) {
  const header = { 'x-company-id': companyId, 'Idempotency-Key': crypto.randomUUID() };
  const client = apiClient();
  if (change.kind === 'create')
    return client.POST('/v1/document-types', { params: { header }, body: terms(change.input) });
  const path = { typeId: change.type.id };
  const expected_revision = change.type.revision;
  if (change.kind === 'update')
    return client.PATCH('/v1/document-types/{typeId}', {
      params: { header, path },
      body: { ...terms(change.input), expected_revision },
    });
  const route =
    change.kind === 'deactivate'
      ? '/v1/document-types/{typeId}/deactivate'
      : '/v1/document-types/{typeId}/reactivate';
  return client.POST(route, { params: { header, path }, body: { expected_revision } });
}

export function useDocumentTypes(companyId: string, userId: string) {
  const client = useQueryClient();
  const key = ['document-types', companyId, userId];
  const list = useQuery({
    queryKey: key,
    staleTime: 0,
    refetchOnMount: 'always',
    retry: false,
    queryFn: async ({ signal }) => {
      const result = await apiClient().GET('/v1/document-types', {
        params: { header: { 'x-company-id': companyId } },
        signal,
      });
      if (result.error) throw { ...result.error, status: result.response.status };
      return documentTypeList.parse(result.data);
    },
  });
  const change = useMutation({
    mutationKey: [...key, 'change'],
    retry: false,
    mutationFn: async (input: DocumentTypeChange) => {
      const result = await send(companyId, input);
      if (result.error) throw result.error;
      return documentType.parse(result.data);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  return { list, change };
}
