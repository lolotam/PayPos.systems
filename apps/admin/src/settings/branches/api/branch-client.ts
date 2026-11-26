import { branch, type Branch, type OpeningHours } from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

export function branchKey(companyId: string, userId: string, branchId: string) {
  return ['branch', companyId, userId, branchId] as const;
}

export async function readBranch(
  companyId: string,
  branchId: string,
  signal: AbortSignal,
): Promise<Branch> {
  const response = await apiClient().GET('/v1/branches/{branchId}', {
    params: { header: { 'x-company-id': companyId }, path: { branchId } },
    signal,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return branch.parse(response.data);
}

export async function writeBranchOpeningHours(
  companyId: string,
  businessId: string,
  branchId: string,
  openingHours: OpeningHours | null,
): Promise<Branch> {
  const response = await apiClient().PUT(
    '/v1/businesses/{businessId}/branches/{branchId}/opening-hours',
    {
      params: { header: { 'x-company-id': companyId }, path: { businessId, branchId } },
      body: { opening_hours: openingHours },
    },
  );
  if (response.error) throw { ...response.error, status: response.response.status };
  return branch.parse(response.data);
}
