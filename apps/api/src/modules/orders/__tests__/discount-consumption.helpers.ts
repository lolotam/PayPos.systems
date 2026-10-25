import { requestDiscountApprovalResponse } from '@pospay/contracts';
import { ids, must, type DiscountRequestFixture } from './session.fixture.ts';

/** لحظة الزيارة التي تطلب فيها الموافقة وتستهلكها، فاليوم المحاسبي واحد في الطلبين. */
export const OCCURRED_AT = '2026-10-14T08:00:00.000Z';

/** سطر الطلب: خدمة سعرها 25.000 وخصم 5.000، أي 2000 وحدة أساس فوق حدّ الكاشير. */
export function draftLine(f: DiscountRequestFixture, employeeIndex = 1) {
  return f.draft(0, '25.000', '5.000', employeeIndex);
}

/** يطلب موافقة على سطر واحد فوق حدّ المسجّلة، ثم يقرّرها المشرف كما يفعل المسار الحقيقي. */
export async function approvedProposal(
  f: DiscountRequestFixture,
  extra: { session_id?: string; occurred_at?: string } = { occurred_at: OCCURRED_AT },
): Promise<string> {
  const id = await requestedProposal(f, extra);
  await decideProposal(f, id, 'APPROVED');
  return id;
}

/** يطلب موافقة على سطر واحد فوق حدّ المسجّلة ويتركها معلّقة. */
export async function pendingProposal(
  f: DiscountRequestFixture,
  extra: { session_id?: string; occurred_at?: string } = { occurred_at: OCCURRED_AT },
): Promise<string> {
  return requestedProposal(f, extra);
}

/** يطلب موافقة على سطر واحد فوق حدّ المسجّلة ويردّها المشرف. */
export async function rejectedProposal(
  f: DiscountRequestFixture,
  extra: { session_id?: string; occurred_at?: string } = { occurred_at: OCCURRED_AT },
): Promise<string> {
  const id = await requestedProposal(f, extra);
  await decideProposal(f, id, 'REJECTED');
  return id;
}

/** يطلب الموافقة على سطر واحد ويعيد معرّف الطلب المقترح. */
export async function requestedProposal(
  f: DiscountRequestFixture,
  extra: { session_id?: string; occurred_at?: string } = { occurred_at: OCCURRED_AT },
): Promise<string> {
  const body = requestDiscountApprovalResponse.parse(await f.request.execute({
    ...f.context(), input: f.requestBody([draftLine(f)], extra),
  }));
  return must(body.proposals[0]).id;
}

/** يقرّر الطلب كما يقرّره المشرف من بعيد: القيم كما تُخزَّن في الصف. */
export async function decideProposal(
  f: DiscountRequestFixture,
  id: string,
  decision: 'APPROVED' | 'REJECTED',
): Promise<void> {
  if (decision === 'APPROVED') {
    await f.h.owner`UPDATE discount_proposals SET status='APPROVED',decided_by=${f.editorId},
      decided_by_membership_id=${f.editorMembership},decided_via='REMOTE',decided_at='2026-10-15T09:00:00.000Z'::timestamptz,
      decider_name_ar='ليلى',decider_name_en='Layla Editor',decider_role='branch_manager',decider_role_is_system=true,
      decider_role_name_ar=NULL,decider_role_name_en='Branch Manager',approved_limit_source='PERSON',approved_limit_bps=2000,
      approver_is_performer=false,reject_reason=NULL WHERE company_id=${f.company} AND id=${id}`;
    return;
  }
  await f.h.owner`UPDATE discount_proposals SET status='REJECTED',decided_by=${f.editorId},
    decided_by_membership_id=${f.editorMembership},decided_via='REMOTE',decided_at='2026-10-15T09:00:00.000Z'::timestamptz,
    decider_name_ar='ليلى',decider_name_en='Layla Editor',decider_role='branch_manager',decider_role_is_system=true,
    decider_role_name_ar=NULL,decider_role_name_en='Branch Manager',reject_reason='The discount is too large'
    WHERE company_id=${f.company} AND id=${id}`;
}

/** صف الطلب كما حُفظ، بكل حقول الحالة والاستهلاك. */
export async function proposalRow(f: DiscountRequestFixture, id: string) {
  const [row] = await f.h.owner`SELECT id,kind,status,session_id,expires_at,consumed_line_id,consumed_at,terms_hash
    FROM discount_proposals WHERE company_id=${f.company} AND id=${id}`;
  return row as Record<string, unknown> | undefined;
}

/** صف السطر كما حُفظ، بحدّ المسجّلة وبالموافقة التي استهلكها. */
export async function lineRow(f: DiscountRequestFixture, lineId: string) {
  const [row] = await f.h.owner`SELECT id,discount_proposal_id,limit_bps_applied,limit_source,net,revision
    FROM service_lines WHERE company_id=${f.company} AND id=${lineId}`;
  return row as Record<string, unknown> | undefined;
}

/** عدّاد الأثر المحفوظ: الجلسات والبنود وأثر الاستهلاك والأحداث ومفاتيح إعادة الطلب. */
export async function storageCounts(f: DiscountRequestFixture) {
  const [row] = await f.h.owner`SELECT
    (SELECT count(*)::int FROM service_sessions WHERE company_id=${f.company}) AS sessions,
    (SELECT count(*)::int FROM service_lines WHERE company_id=${f.company}) AS lines,
    (SELECT count(*)::int FROM audit_log WHERE company_id=${f.company} AND action='discount_proposal.consumed') AS consumed,
    (SELECT count(*)::int FROM outbox WHERE company_id=${f.company}) AS events,
    (SELECT count(*)::int FROM idempotency_keys WHERE company_id=${f.company}) AS keys`;
  return row as Record<string, number>;
}

/** أثر الاستهلاك المحفوظ لطلب واحد، بلا اسم ولا هاتف. */
export async function consumedAudits(f: DiscountRequestFixture, proposalId: string) {
  return f.h.owner`SELECT entity,entity_id,action,after FROM audit_log
    WHERE company_id=${f.company} AND action='discount_proposal.consumed' AND entity_id=${proposalId} ORDER BY id`;
}

/** يزرع طلب موافقة في صفّ مباشر، لحالات لا يغطّيها مسار الطلب نفسه. */
export async function seedProposal(f: DiscountRequestFixture, over: {
  businessId?: string; branchId?: string; serviceId?: string; serviceName?: string; status?: 'PENDING' | 'APPROVED';
} = {}): Promise<string> {
  const id = ids.newId();
  const businessId = over.businessId ?? f.business;
  const branchId = over.branchId ?? f.branch;
  const serviceId = over.serviceId ?? must(f.services[0]);
  const serviceName = over.serviceName ?? 'Synthetic service 0';
  await f.h.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,service_name_ar,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_name_ar,requester_name_en,requester_role,requester_role_is_system,
    requester_role_name_ar,requester_role_name_en,requester_first_name_en,requester_first_name_ar,customer_first_name,requested_at,status,expires_at)
    VALUES(${f.company},${id},${businessId},${branchId},${ids.newId()},0,'RECORD',NULL,'2026-10-14T08:00:00.000Z'::timestamptz,
    ${f.customer},${serviceId},${serviceName},NULL,'{}'::jsonb,${'a'.repeat(64)},2000,${f.userId},${f.membership},'PERSON',1000,
    NULL,NULL,'cashier',true,NULL,'Cashier',NULL,NULL,'Synthetic','2026-10-14T08:00:00.000Z'::timestamptz,'PENDING',
    '2026-10-15T08:00:00.000Z'::timestamptz)`;
  if (over.status === 'APPROVED') await decideProposal(f, id, 'APPROVED');
  return id;
}

/** يزرع طلب تعديل فوق سطر محفوظ، فهو من نوع EDIT لا يقبله مسار التسجيل. */
export async function seedEditProposal(f: DiscountRequestFixture, lineId: string, sessionId: string): Promise<string> {
  const id = ids.newId();
  await f.h.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,line_id,base_revision,
    base_price,base_discount,base_net,session_id,occurred_at,customer_id,service_id,service_name_en,service_name_ar,terms,terms_hash,
    effective_bps,requested_by,requested_by_membership_id,requester_limit_source,requester_limit_bps,requester_name_ar,requester_name_en,
    requester_role,requester_role_is_system,requester_role_name_ar,requester_role_name_en,requester_first_name_en,requester_first_name_ar,
    customer_first_name,requested_at,status,expires_at)
    VALUES(${f.company},${id},${f.business},${f.branch},${ids.newId()},0,'EDIT',${lineId},1,'25.000','0.000','25.000',
    ${sessionId},'2026-10-14T08:00:00.000Z'::timestamptz,${f.customer},${must(f.services[0])},'Synthetic service 0',NULL,'{}'::jsonb,
    ${'a'.repeat(64)},2000,${f.userId},${f.membership},'PERSON',1000,NULL,NULL,'cashier',true,NULL,'Cashier',NULL,NULL,'Synthetic',
    '2026-10-14T08:00:00.000Z'::timestamptz,'PENDING','2026-10-15T08:00:00.000Z'::timestamptz)`;
  return id;
}
