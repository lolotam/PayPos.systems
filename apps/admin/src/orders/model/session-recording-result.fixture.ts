import type { RecordServiceSessionResponse, RejectedServiceLine, SavedServiceLine } from '@pospay/contracts';
import { serviceSessionErrors } from '@pospay/i18n';
import { freezeSessionAttempt } from './session-attempt';
import { createSessionDraft } from './session-drafts';
import { emptySessionRecordingResult } from './session-recording-result';

export const id = (n: number) => `01920000-0000-7000-8000-${n.toString().padStart(12, '0')}`;
export const instant = '2026-10-13T08:00:00.000Z';
export const scope = { companyId: id(1), businessId: id(2), branchId: id(3), userId: id(4) };
export const inputLine = { service_id: id(5), price: '7.125', discount: { kind: 'PERCENT' as const, bps: 1000 }, performers: [{ employee_id: id(6) }] };
export const savedLine: SavedServiceLine = { id: id(11), session_id: id(12), service_id: id(5), input_index: 0, ordinal: 1, name_en: 'Synthetic service', name_ar: null,
  list_price: '7.125', price: '7.125', discount: '0.713', net: '6.412', effective_discount_bps: 1001, limit_bps_applied: null,
  limit_source: 'OWNER', status: 'ACTIVE', revision: 1, rule_snapshot: { kind: 'FOLLOW_PLAN' }, counts_snapshot: true, catalog_revision: 1,
  has_performer_warning: true, recorded_by: scope.userId, recorded_by_membership_id: id(8), recorded_at: instant, late: false,
  performers: [{ id: id(13), employee_id: id(6), performer_ordinal: 1, share_bps: 3334, name_en: 'Synthetic performer', name_ar: null,
    not_clocked_in_warning: true, approved_leave_warning: true }, ...[17, 18].map((n, index) => ({ id: id(n), employee_id: id(n), performer_ordinal: index + 2,
      share_bps: 3333, name_en: `Synthetic performer ${n}`, name_ar: null, not_clocked_in_warning: false, approved_leave_warning: false }))] };
export const rejection: RejectedServiceLine = { input_index: 1, service_id: id(5), name_ar: null, name_en: 'Synthetic service',
  code: 'SESSION_DISCOUNT_ABOVE_LIMIT', ...serviceSessionErrors.SESSION_DISCOUNT_ABOVE_LIMIT,
  list_price: '7.125', price: '7.125', discount: '0.713', net: '6.412', effective_discount_bps: 1001, limit_bps: 1000,
  limit_source: 'PERSON', minimum_net: '6.413', max_discount_amount: '0.712' };
export const response: RecordServiceSessionResponse = { outcome: 'PARTIAL', session: { id: id(12), business_id: scope.businessId, branch_id: scope.branchId,
  customer: { id: id(7), name: 'Synthetic customer', phone_masked: '***001' }, recorded_by: scope.userId, recorded_by_membership_id: id(8),
  occurred_at: instant, recorded_at: instant, business_date: '2026-10-13', business_timezone: 'Asia/Kuwait', late: false, total_net: '6.412', lines: [savedLine] }, rejected_lines: [rejection] };
export const initial = { ...emptySessionRecordingResult({ id: id(7), name: 'Synthetic customer', phone: '***001' }),
  drafts: { occurred_at: instant, recorder_membership_id: id(8), lines: [9, 10].map((n) => ({ ...createSessionDraft(id(n)), service_id: id(5), price: '7.125',
    discount_kind: 'PERCENT' as const, discount_percentage: '10' })) } };
export const attempt = freezeSessionAttempt(scope, { kind: 'record', body: { customer_id: id(7), lines: [inputLine, inputLine] } }, [id(9), id(10)], { now: () => Date.parse(instant), newId: () => id(20) });
export const recordAttempt = { ...attempt, kind: 'record' as const, body: { customer_id: id(7), lines: [inputLine, inputLine] } };
export const appendAttempt = { ...attempt, kind: 'append' as const, sessionId: id(12), body: { lines: [inputLine, inputLine] } };
export const discountError = { status: 422, code: rejection.code, ...serviceSessionErrors.SESSION_DISCOUNT_ABOVE_LIMIT, details: { rejected_lines: [rejection] } };
