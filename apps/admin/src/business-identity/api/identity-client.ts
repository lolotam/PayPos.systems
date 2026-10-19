import {
  businessIdentity,
  businessIdentityNames,
  businessLogo,
  businessSettings,
  fileDownload,
  identityCapability,
  type BusinessIdentity,
  type BusinessIdentityNames,
  type BusinessLogo,
  type BusinessSettings,
  type UpdateBusinessIdentityNamesInput,
} from '@pospay/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/api/client';

export function businessSettingsKey(companyId: string, userId: string, businessId: string) {
  return ['business-settings', companyId, userId, businessId] as const;
}

export function businessIdentityAccessKey(companyId: string, userId: string, businessId: string) {
  return ['business-identity-access', companyId, userId, businessId] as const;
}

export function businessIdentityKey(companyId: string, userId: string, businessId: string) {
  return ['business-identity', companyId, userId, businessId] as const;
}

function header(companyId: string) {
  return { 'x-company-id': companyId };
}

export function withHttpStatus(error: unknown, status: number | undefined): unknown {
  if (typeof error !== 'object' || error === null || status === undefined) return error;
  return { ...error, status };
}

function fail(error: unknown, status: number | undefined): never {
  throw withHttpStatus(error, status);
}

export async function readBusinessSettings(
  companyId: string,
  businessId: string,
): Promise<BusinessSettings> {
  const response = await apiClient().GET('/v1/businesses/{businessId}/settings', {
    params: { header: header(companyId), path: { businessId } },
  });
  if (response.error) fail(response.error, response.response.status);
  return businessSettings.parse(response.data);
}

function namesBody(body: UpdateBusinessIdentityNamesInput) {
  const payload: { official_name_ar?: string | null; official_name_en?: string | null } = {};
  if (body.official_name_ar !== undefined) payload.official_name_ar = body.official_name_ar;
  if (body.official_name_en !== undefined) payload.official_name_en = body.official_name_en;
  return payload;
}

export async function patchIdentityNames(
  companyId: string,
  businessId: string,
  body: UpdateBusinessIdentityNamesInput,
): Promise<BusinessIdentityNames> {
  const response = await apiClient().PATCH('/v1/businesses/{businessId}/settings/identity', {
    params: { header: header(companyId), path: { businessId } },
    body: namesBody(body),
  });
  if (response.error) fail(response.error, response.response.status);
  return businessIdentityNames.parse(response.data);
}

export async function putBusinessLogo(
  companyId: string,
  businessId: string,
  fileId: string | null,
): Promise<BusinessLogo> {
  const response = await apiClient().PUT('/v1/businesses/{businessId}/settings/logo', {
    params: { header: header(companyId), path: { businessId } },
    body: { file_id: fileId },
  });
  if (response.error) fail(response.error, response.response.status);
  return businessLogo.parse(response.data);
}

export async function issueLogoDownload(companyId: string, fileId: string, signal?: AbortSignal) {
  const response = await apiClient().POST('/v1/files/{id}/download', {
    params: { header: header(companyId), path: { id: fileId } },
    ...(signal ? { signal } : {}),
  });
  if (response.error) fail(response.error, response.response.status);
  return fileDownload.parse(response.data);
}

export async function readBusinessIdentityView(
  companyId: string,
  businessId: string,
): Promise<BusinessIdentity> {
  const response = await apiClient().GET('/v1/businesses/{businessId}/settings/identity', {
    params: { header: header(companyId), path: { businessId } },
  });
  if (response.error) fail(response.error, response.response.status);
  return businessIdentity.parse(response.data);
}

export async function readIdentityCapability(
  companyId: string,
  businessId: string,
): Promise<boolean> {
  const response = await apiClient().GET(
    '/v1/businesses/{businessId}/settings/identity-capability',
    { params: { header: header(companyId), path: { businessId } } },
  );
  if (response.error) fail(response.error, response.response.status);
  return identityCapability.parse(response.data).can_manage_identity;
}

type SettingsPatch = Partial<
  Pick<BusinessSettings, 'official_name_ar' | 'official_name_en' | 'logo_file_id'>
>;

/** نفس مفتاح إعدادات النشاط في شاشة الخصم، عشان الحفظ يحدّث الصف المخزّن من غير ما يخترع صفًا. */
export function mergeBusinessSettings(
  client: QueryClient,
  companyId: string,
  userId: string,
  businessId: string,
  patch: SettingsPatch,
) {
  const key = businessSettingsKey(companyId, userId, businessId);
  const current = client.getQueryData<BusinessSettings>(key);
  if (!current) return;
  client.setQueryData<BusinessSettings>(key, { ...current, ...patch });
}

type IdentityPatch = Partial<
  Pick<BusinessIdentity, 'official_name_ar' | 'official_name_en' | 'logo_file_id'>
>;

/**
 * بيلغي قراءة الهوية وقراءة الإعدادات اللي لسه في الطريق قبل كتابة الحفظ.
 * الرد القديم لو وصل بعد كده ما يحقّلوش يغطّي الأسماء أو الشعار، وبعدين القراءة تتطلب من جديد.
 */
export async function refreshBusinessIdentity(
  client: QueryClient,
  companyId: string,
  userId: string,
  businessId: string,
  patch: IdentityPatch,
) {
  const identityKey = businessIdentityKey(companyId, userId, businessId);
  const settingsKey = businessSettingsKey(companyId, userId, businessId);
  await Promise.all([
    client.cancelQueries({ queryKey: identityKey }),
    client.cancelQueries({ queryKey: settingsKey }),
  ]);
  client.setQueryData<BusinessIdentity>(identityKey, (current) =>
    current ? { ...current, ...patch } : current,
  );
  mergeBusinessSettings(client, companyId, userId, businessId, patch);
  await Promise.all([
    client.invalidateQueries({ queryKey: identityKey }),
    client.invalidateQueries({ queryKey: settingsKey }),
  ]);
}
