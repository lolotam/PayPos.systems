import {
  alertRules,
  type AlertKindCode,
  type AlertRules,
  ratingSettings,
  type RatingSettings,
  type ResetBranchAlertRuleQuery,
  type SetAlertRulesInput,
} from '@pospay/contracts';
import { apiClient } from '@/shared/api/client';

const businessPath = '/v1/businesses/{businessId}/alert-rules';
const masterPath = '/v1/businesses/{businessId}/alert-rules/master';
const branchPath = '/v1/businesses/{businessId}/branches/{branchId}/alert-rules';
const resetPath = '/v1/businesses/{businessId}/branches/{branchId}/alert-rules/{kind}';
const ratingSettingsPath = '/v1/businesses/{businessId}/rating-settings';

export function alertRulesBusinessKey(companyId: string, userId: string, businessId: string) {
  return ['alert-rules', companyId, userId, businessId] as const;
}

export function alertRulesWriteKey(companyId: string, userId: string, businessId: string) {
  return ['alert-rules-write', companyId, userId, businessId] as const;
}

export function alertRulesKey(
  companyId: string,
  userId: string,
  businessId: string,
  branchId: string | null,
) {
  return [...alertRulesBusinessKey(companyId, userId, businessId), branchId] as const;
}

export function alertRulesKeyBranch(queryKey: readonly unknown[]): string | null {
  const branchId = queryKey[4];
  return typeof branchId === 'string' ? branchId : null;
}

export async function readAlertRules(
  companyId: string,
  businessId: string,
  branchId: string | null,
  signal: AbortSignal,
): Promise<AlertRules> {
  const header = { 'x-company-id': companyId };
  const response = branchId
    ? await apiClient().GET(branchPath, {
        params: { header, path: { businessId, branchId } },
        signal,
      })
    : await apiClient().GET(businessPath, { params: { header, path: { businessId } }, signal });
  if (response.error) throw { ...response.error, status: response.response.status };
  return alertRules.parse(response.data);
}

export async function saveAlertRules(
  companyId: string,
  businessId: string,
  branchId: string | null,
  body: SetAlertRulesInput,
): Promise<AlertRules> {
  const header = { 'x-company-id': companyId };
  const response = branchId
    ? await apiClient().PUT(branchPath, {
        params: { header, path: { businessId, branchId } },
        body,
      })
    : await apiClient().PUT(businessPath, { params: { header, path: { businessId } }, body });
  if (response.error) throw { ...response.error, status: response.response.status };
  return alertRules.parse(response.data);
}

export async function setAlertsMaster(
  companyId: string,
  businessId: string,
  enabled: boolean,
): Promise<AlertRules> {
  const response = await apiClient().PUT(masterPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: { alerts_enabled: enabled },
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return alertRules.parse(response.data);
}

export async function resetBranchAlertRule(
  companyId: string,
  businessId: string,
  branchId: string,
  kind: AlertKindCode,
  expected: ResetBranchAlertRuleQuery,
): Promise<void> {
  const response = await apiClient().DELETE(resetPath, {
    params: {
      header: { 'x-company-id': companyId },
      path: { businessId, branchId, kind },
      query: expected,
    },
  });
  if (response.error) throw { ...response.error, status: response.response.status };
}

export function ratingSettingsKey(companyId: string, userId: string, businessId: string) {
  return ['rating-settings', companyId, userId, businessId] as const;
}

export async function readRatingSettings(
  companyId: string,
  businessId: string,
  signal: AbortSignal,
): Promise<RatingSettings> {
  const response = await apiClient().GET(ratingSettingsPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    signal,
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return ratingSettings.parse(response.data);
}

export async function setRatingRequests(
  companyId: string,
  businessId: string,
  enabled: boolean,
): Promise<RatingSettings> {
  const response = await apiClient().PUT(ratingSettingsPath, {
    params: { header: { 'x-company-id': companyId }, path: { businessId } },
    body: { requests_enabled: enabled },
  });
  if (response.error) throw { ...response.error, status: response.response.status };
  return ratingSettings.parse(response.data);
}
