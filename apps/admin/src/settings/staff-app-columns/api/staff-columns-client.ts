import {
  staffColumnsSettings,
  type ReplaceStaffColumnsInput,
  type StaffColumnsSettings,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

const staffColumnsPath = '/v1/businesses/{businessId}/settings/staff-columns';

/**
 * مفتاح قراءة أعمدة تطبيق الموظفين.
 * فيه المستخدم لأن المنع DENY بيتفلتر لكل صاحب صلاحية لوحده (PP-3.1).
 */
export function staffColumnsKey(companyId: string, userId: string, businessId: string) {
  return ['staff-app-columns', companyId, userId, businessId] as const;
}

export async function readStaffColumns(
  companyId: string,
  businessId: string,
  signal: AbortSignal,
): Promise<StaffColumnsSettings> {
  const response = await apiClient().GET(staffColumnsPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    signal,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return staffColumnsSettings.parse(response.data);
}

export async function saveStaffColumns(
  companyId: string,
  businessId: string,
  idempotencyKey: string,
  body: ReplaceStaffColumnsInput,
): Promise<StaffColumnsSettings> {
  const response = await apiClient().PUT(staffColumnsPath, {
    params: {
      header: { 'x-company-id': companyId, 'Idempotency-Key': idempotencyKey },
      path: { businessId },
    },
    body,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return staffColumnsSettings.parse(response.data);
}
