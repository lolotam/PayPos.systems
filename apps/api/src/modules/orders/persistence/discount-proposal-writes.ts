import type { Tx } from '@pospay/db';
import { sql } from 'drizzle-orm';
import type { DiscountProposalPlan } from '../domain/discount-request.ts';

/**
 * يدخل الاقتراحات كلها بأمر واحد، ثم منفّذيها بأمر ثانٍ: طلب واحد أو لا شيء.
 * أعمدة القرار والاستهلاك لا تُذكر أصلاً، فتبقى NULL ويبقى الطلب معلقاً (PENDING).
 * الشروط تُخزَّن كنصها القانوني، فالمخزَّن هو نفس ما حُسبت بصمته (D-2).
 *
 * @param tx معاملة الشركة
 * @param companyId الشركة المؤكدة
 * @param businessId النشاط الذي أثبته tenancy
 * @param branchId فرع الزيارة
 * @param proposals الاقتراحات الجاهزة بكل لقطاتها
 * @returns يكتمل إدخال كل الصفوف
 */
export async function insertDiscountProposals(
  tx: Tx,
  companyId: string,
  businessId: string,
  branchId: string,
  proposals: readonly DiscountProposalPlan[],
): Promise<void> {
  if (proposals.length === 0) return;
  const rows = proposals.map((proposal) => sql`(${companyId},${proposal.id},${businessId},${branchId},${proposal.request_id},${proposal.input_index},
    'RECORD',${proposal.session_id},${proposal.occurred_at.toISOString()}::timestamptz,${proposal.customer_id},${proposal.service_id},
    ${proposal.service_name_en},${proposal.service_name_ar},${proposal.terms_text}::jsonb,${proposal.terms_hash},${proposal.effective_bps},
    ${proposal.requested_by},${proposal.requested_by_membership_id},${proposal.requester_limit_source},${proposal.requester_limit_bps},
    ${proposal.requester_name_ar},${proposal.requester_name_en},${proposal.requester_role},${proposal.requester_role_is_system},
    ${proposal.requester_role_name_ar},${proposal.requester_role_name_en},${proposal.requester_first_name_en},${proposal.requester_first_name_ar},
    ${proposal.customer_first_name},${proposal.requested_at.toISOString()}::timestamptz,'PENDING',${proposal.expires_at.toISOString()}::timestamptz)`);
  await tx.execute(sql`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,service_name_ar,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_name_ar,requester_name_en,requester_role,requester_role_is_system,
    requester_role_name_ar,requester_role_name_en,requester_first_name_en,requester_first_name_ar,customer_first_name,requested_at,status,expires_at)
    VALUES ${sql.join(rows, sql`,`)}`);
  const performers = proposals.flatMap((proposal) => proposal.performers.map((performer) => sql`(${companyId},${performer.id},${businessId},
    ${proposal.id},${performer.employee_id},${performer.linked_user_id},${performer.first_name_en},${performer.first_name_ar})`));
  if (performers.length === 0) return;
  await tx.execute(sql`INSERT INTO discount_proposal_performers(company_id,id,business_id,proposal_id,employee_id,linked_user_id,first_name_en,first_name_ar)
    VALUES ${sql.join(performers, sql`,`)}`);
}
