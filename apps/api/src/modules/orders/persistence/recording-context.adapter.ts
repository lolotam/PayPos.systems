import type { Tx } from '@pospay/db';
import { readServiceSessionAccess } from '../../identity/index.ts';
import { readEffectiveDiscountLimit } from '../../settings/index.ts';
import { sessionPerformersCapability } from './session-edit-access.adapter.ts';

export function recordingAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string, at: Date) {
  return readServiceSessionAccess(tx, companyId, userId, businessId, branchId, at);
}
// قايمة محرر المنفّذين بتقبل صلاحية التغيير كمان (PP-19.1)؛ القراءتين في نفس المعاملة وورا بعض عشان معاملة واحدة ما تشتغلش بالتوازي.
export async function pickerAccess(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string, at: Date) {
  const record = await readServiceSessionAccess(tx, companyId, userId, businessId, branchId, at);
  const performers = await sessionPerformersCapability(tx, companyId, userId, businessId, branchId, at);
  return { ...record, feature: record.feature || performers.feature,
    change: !performers.denied && performers.eligible.length > 0 };
}
// قدرة التسجيل لقائمة اليوم: نفس قراءة الإذن من غير أقفال؛ العضويات بتتعد مؤهلة بس لما الإذن ساري بعد المنع.
export async function sessionRecordCapability(tx: Tx, companyId: string, userId: string, businessId: string, branchId: string, at: Date) {
  const access = await readServiceSessionAccess(tx, companyId, userId, businessId, branchId, at);
  return { denied: access.denied, feature: access.feature, eligible: access.record ? access.membership_ids : [] };
}
export async function recordingLimit(tx: Tx, companyId: string, businessId: string, membershipId: string) {
  const limit = await readEffectiveDiscountLimit(tx, companyId, businessId, membershipId);
  switch (limit.status) {
    case 'MEMBERSHIP_NOT_FOUND': return null;
    case 'UNLIMITED': return { source: 'OWNER' as const, bps: null };
    case 'NOT_CONFIGURED': return { source: 'NOT_CONFIGURED' as const, bps: 0 as const };
    case 'SET': return { source: limit.source, bps: limit.limit_bps };
  }
}
