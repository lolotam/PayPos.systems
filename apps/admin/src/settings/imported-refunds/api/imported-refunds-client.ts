import {
  importedRefundsResponse,
  type ImportedRefundsResponse,
  type SetImportedRefundsInput,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

const switchPath = '/v1/businesses/{businessId}/settings/imported-refunds';

export function importedRefundsKey(companyId: string, userId: string, businessId: string) {
  return ['imported-refunds', companyId, userId, businessId] as const;
}

export async function readImportedRefunds(
  companyId: string,
  businessId: string,
  signal: AbortSignal,
): Promise<ImportedRefundsResponse> {
  const response = await apiClient().GET(switchPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    signal,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return importedRefundsResponse.parse(response.data);
}

export async function setImportedRefunds(
  companyId: string,
  businessId: string,
  body: SetImportedRefundsInput,
): Promise<ImportedRefundsResponse> {
  const response = await apiClient().PUT(switchPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return importedRefundsResponse.parse(response.data);
}
