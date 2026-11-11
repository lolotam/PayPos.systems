import { requestDiscountApprovalResponse } from '@pospay/contracts';
import { SYSTEM_ROLES } from '@pospay/db';
import { editorLabel } from '@pospay/i18n';
import { ids, must, type DiscountRequestFixture } from './session.fixture.ts';
import { ordersDiscountDecisions } from '../orders.module.ts';
import { DecideDiscountProposalsUseCase } from '../use-cases/decide-discount-proposals/decide-discount-proposals.usecase.ts';
import type { DiscountDeciderSnapshot } from '../domain/discount-decision-plan.ts';

/**
 * يبني لقب المُوافِق بالعربية والإنجليزية بنفس صياغة الإنتاج في `orders.module.ts`.
 *
 * @param snapshot لقطة الاسم والدور للمقرر
 * @returns اللقبان المنسقان
 */
export function testDecisionLabels(snapshot: DiscountDeciderSnapshot) {
  const editor = {
    nameAr: snapshot.decider_name_ar,
    nameEn: snapshot.decider_name_en,
    role: snapshot.decider_role,
    roleIsSystem: snapshot.decider_role_is_system,
    roleNameAr: snapshot.decider_role_name_ar,
    roleNameEn: snapshot.decider_role_name_en,
  };
  return { ar: editorLabel('ar', editor), en: editorLabel('en', editor) };
}

/**
 * ينشئ حالة استخدام اتخاذ القرار مستندة إلى قاعدة بيانات وساعة التجهيز المشتركة.
 *
 * @param f تجهيز طلب الخصم
 * @returns حالة استخدام اتخاذ القرار
 */
export function createDecideUseCase(f: DiscountRequestFixture) {
  return new DecideDiscountProposalsUseCase(ordersDiscountDecisions(f.db, ids), f.clock, testDecisionLabels);
}

/**
 * يبني سياق تنفيذ قرار الخصم مع مفتاح وبصمة فريدين افتراضياً.
 *
 * @param f تجهيز طلب الخصم
 * @param actorUserId مستخدم المُوافِق أو المقرّر (افتراضياً مديرة الفرع)
 * @param extra تجاوزات اختيارية للفرع أو النشاط أو المفتاح
 * @returns سياق الكتابة
 */
export function decideContext(
  f: DiscountRequestFixture,
  actorUserId = f.editorId,
  extra: { branchId?: string; businessId?: string; key?: string; fingerprint?: string } = {},
) {
  return {
    companyId: f.company,
    userId: actorUserId,
    businessId: extra.businessId ?? f.business,
    branchId: extra.branchId ?? f.branch,
    key: extra.key ?? ids.newId(),
    fingerprint: extra.fingerprint ?? 'a'.repeat(64),
  };
}

/**
 * يطلب اقتراح خصم واحداً ويعيد بياناته الأساسية وبصمة شروطه.
 *
 * @param f تجهيز طلب الخصم
 * @param discount مبلغ الخصم
 * @param price السعر
 * @param employeeIndex مؤشر المنفذة في مصفوفة موظفي التجهيز
 * @returns الاقتراح المطلوب
 */
export async function requestSingleProposal(
  f: DiscountRequestFixture,
  discount = '5.000',
  price = '25.000',
  employeeIndex = 1,
) {
  const body = requestDiscountApprovalResponse.parse(
    await f.request.execute({
      ...f.context(),
      input: f.requestBody([f.draft(0, price, discount, employeeIndex)]),
    }),
  );
  return must(body.proposals[0]);
}

/**
 * يطلب دفعة اقتراحات خصم ويعيدها بنفس الترتيب.
 *
 * @param f تجهيز طلب الخصم
 * @param lines مواصفات كل سطر في الدفعة
 * @returns مصفوفة الاقتراحات المطلوبة
 */
export async function requestBatchProposals(
  f: DiscountRequestFixture,
  lines: Array<{ discount?: string; price?: string; employeeIndex?: number }> = [{}, {}],
) {
  const drafts = lines.map((line) =>
    f.draft(0, line.price ?? '25.000', line.discount ?? '5.000', line.employeeIndex ?? 1),
  );
  const body = requestDiscountApprovalResponse.parse(
    await f.request.execute({
      ...f.context(),
      input: f.requestBody(drafts),
    }),
  );
  return body.proposals;
}

/**
 * يجلب صف الاقتراح كاملاً من قاعدة البيانات.
 *
 * @param f تجهيز طلب الخصم
 * @param id معرّف الاقتراح
 * @returns سجل الاقتراح إن وُجد
 */
export async function fetchProposal(f: DiscountRequestFixture, id: string) {
  const [row] = await f.h.owner`SELECT * FROM discount_proposals WHERE company_id=${f.company} AND id=${id}`;
  return row as Record<string, unknown> | undefined;
}

/**
 * يجلب سجلات التدقيق المرتبطة باقتراح معين.
 *
 * @param f تجهيز طلب الخصم
 * @param proposalId معرّف الاقتراح
 * @param action نوع التدقيق إن رُغب في تقييده
 * @returns صفوف التدقيق
 */
export async function fetchAudits(f: DiscountRequestFixture, proposalId: string, action?: string) {
  if (action !== undefined) {
    return f.h.owner`SELECT * FROM audit_log WHERE company_id=${f.company} AND entity_id=${proposalId} AND action=${action} ORDER BY id`;
  }
  return f.h.owner`SELECT * FROM audit_log WHERE company_id=${f.company} AND entity_id=${proposalId} ORDER BY id`;
}

/**
 * يجلب أحداث الـ outbox من نوع معين للشركة.
 *
 * @param f تجهيز طلب الخصم
 * @param eventType نوع الحدث
 * @returns أحداث الـ outbox
 */
export async function fetchOutboxEvents(f: DiscountRequestFixture, eventType = 'DiscountApprovedByPerformer') {
  return f.h.owner`SELECT * FROM outbox WHERE company_id=${f.company} AND event_type=${eventType} ORDER BY id`;
}

/**
 * يدرج عضوية ثانية مؤهلة للمستخدم على نفس الفرع، لاختبار الحاجة لاختيار صريح (D-11).
 *
 * @param f تجهيز طلب الخصم
 * @param userId المستخدم المعني (افتراضياً مديرة الفرع)
 * @param roleCode كود الدور
 * @param limitBps حد الخصم للعضوية
 * @returns معرّف العضوية المدرجة
 */
export async function insertSecondEligibleMembership(
  f: DiscountRequestFixture,
  userId = f.editorId,
  roleCode = 'business_manager',
  limitBps = 2500,
) {
  const role = must(SYSTEM_ROLES.find((item) => item.code === roleCode)).id;
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membershipId},${userId},${role},'global','BRANCH',${f.branch},${limitBps},'2026-01-01T00:00:00Z')`;
  return membershipId;
}

/**
 * يمنح المنفّذة دوراً يمنح الموافقة على الفرع، لاختبار حالة موافقة المنفّذة على عملها (DP-19).
 *
 * @param f تجهيز طلب الخصم
 * @param roleCode كود الدور
 * @param limitBps حد الخصم
 * @returns معرّف العضوية
 */
export async function grantPerformerApprovalRole(
  f: DiscountRequestFixture,
  roleCode = 'branch_manager',
  limitBps = 3000,
) {
  const role = must(SYSTEM_ROLES.find((item) => item.code === roleCode)).id;
  const membershipId = ids.newId();
  await f.h.owner`INSERT INTO memberships(company_id,id,user_id,role_id,role_owner_key,scope_type,scope_id,limit_bps,starts_at)
    VALUES(${f.company},${membershipId},${f.performerUserId},${role},'global','BRANCH',${f.branch},${limitBps},'2026-01-01T00:00:00Z')`;
  return membershipId;
}

/**
 * بينهي عضوية اختبار بدل حذفها، لأن الاقتراح اللي اتقرر بيها بيشاور عليها
 * بمفتاح أجنبي (dp_decider_membership_fk)، وسجل القرار ما بيتمسحش.
 *
 * @param f تجهيز طلب الخصم
 * @param membershipId العضوية المطلوب إنهاؤها
 * @returns وعد بيخلص بعد الإنهاء
 */
export async function endMembership(f: DiscountRequestFixture, membershipId: string) {
  await f.h.owner`UPDATE memberships SET ends_at='2026-01-02T00:00:00Z' WHERE company_id=${f.company} AND id=${membershipId}`;
}
