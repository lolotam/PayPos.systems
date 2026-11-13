import type { DestinationStream } from '@pospay/observability';

import { authPinHasher } from '../src/modules/identity/persistence/auth-pin-hasher.ts';
import { discountRequestFixture, type DiscountRequestFixture } from './discount-request.fixture.ts';
import { ids, must } from './service-session.fixture.ts';
import { origin, paired, phone } from './staff-otp-harness.ts';

/** ساعة اختبارات موافقة الخصم: 15 أكتوبر 2026، مثل بقية اختبارات الطلبات. */
export const PIN_CLOCK = new Date('2026-10-15T08:00:00.000Z');

/** الرقم السري الذي يكتبه المُوافِق على جهاز الفرع. */
export const APPROVER_PIN = '1234';

/** مسار قائمة طلبات الفرع على الجهاز. */
export const DEVICE_PROPOSALS = '/v1/devices/me/discount-proposals';

export interface DiscountPinFixtureOptions {
  /** وجهة سجلات الـ API، لو الاختبار يريد قراءة ما كتبه الطريق. */
  logs?: DestinationStream;
}

/** مواصفات proposal مزروع باليد: وقت طلبه ووقت انتهاءه. */
export interface ProposalSeed {
  requestedAt: string;
  expiresAt: string;
}

/**
 * يبني تجهيز موافقة الخصم بالرقم السري: طلب الخصم، ومُوافِق له ربط هاتف معتمد ورقم سري،
 * وجهازان مقترنان — واحد في فرع الطلب وآخر في فرع آخر.
 *
 * @param options خيارات التجهيز، منها وجهة السجلات
 * @returns تجهيز موافقة الخصم بجهازيه ومُوافِقه
 */
export async function discountPinFixture(options: DiscountPinFixtureOptions = {}) {
  let at = PIN_CLOCK;
  const clock = { now: () => at };
  const base = await discountRequestFixture({
    staffOrigin: origin,
    ordersClock: clock,
    ...(options.logs === undefined ? {} : { logs: options.logs }),
  });
  const approver = await bindApprover(base, base.editorId, phone);
  const device = await paired(base.h, base.ownerCookie, base.company, base.branch);
  const otherDevice = await paired(base.h, base.ownerCookie, base.company, base.otherBranch);
  const deviceGet = (path: string, token: string) =>
    base.h.app.inject({ method: 'GET', url: path, headers: { authorization: `Device ${token}` } });
  const devicePost = (path: string, token: string, body: object) =>
    base.h.app.inject({
      method: 'POST',
      url: path,
      headers: { authorization: `Device ${token}` },
      payload: body,
    });
  return {
    ...base,
    device,
    otherDevice,
    approver,
    deviceGet,
    devicePost,
    bind: (userId: string, phoneNumber: string) => bindApprover(base, userId, phoneNumber),
    pairDevice: (branchId: string) => paired(base.h, base.ownerCookie, base.company, branchId),
    seedProposal: (branchId: string, seed: ProposalSeed) => seedProposal(base, branchId, seed),
    setAt: (next: Date) => {
      at = next;
      base.setAt(next);
    },
  };
}

export type DiscountPinFixture = Awaited<ReturnType<typeof discountPinFixture>>;

/**
 * يربط هاتفاً معتمداً لمستخدم ويضع له رقمه السري بنفس منشأة الاعتماد في الهوية.
 *
 * @param f تجهيز طلب الخصم
 * @param userId المستخدم الذي يوقّع برقمه السري
 * @param phoneNumber الرقم المعتمد، ورقم مختلف لكل مستخدم
 * @returns الهاتف والرقم السري لطلب الموافقة
 */
async function bindApprover(f: DiscountRequestFixture, userId: string, phoneNumber: string) {
  await f.h.owner`UPDATE "user" SET phone_number=${phoneNumber} WHERE id=${userId}`;
  await f.h.owner`UPDATE "user" SET phone_binding_approved_at=clock_timestamp() WHERE id=${userId}`;
  const hash = await authPinHasher.hash(APPROVER_PIN);
  await f.h.owner`INSERT INTO cashier_pins(company_id,id,user_id,pin_hash,set_by,set_at)
    VALUES(${f.company},${ids.newId()},${userId},${hash},${f.ownerId},clock_timestamp())
    ON CONFLICT(company_id,user_id) DO UPDATE SET id=EXCLUDED.id,pin_hash=EXCLUDED.pin_hash,
      set_by=EXCLUDED.set_by,set_at=EXCLUDED.set_at`;
  return { phone: phoneNumber, pin: APPROVER_PIN };
}

/**
 * يزرع اقتراح خصم معلّقاً باليد في فرع محدد، لاختبار فرع/device لا يملكه.
 *
 * @param f تجهيز طلب الخصم
 * @param branchId الفرع الذي يُزرع فيه الاقتراح
 * @param seed وقت الطلب ووقت الانتهاء
 * @returns معرّف الاقتراح المزروع
 */
async function seedProposal(f: DiscountRequestFixture, branchId: string, seed: ProposalSeed) {
  const proposalId = ids.newId();
  const employeeId = must(f.employees[1]);
  const terms = {
    v: 1,
    company_id: f.company,
    business_id: f.business,
    branch_id: branchId,
    customer_id: f.customer,
    session_id: null,
    occurred_business_date: seed.requestedAt.slice(0, 10),
    service_id: must(f.services[0]),
    list_price: '25.000',
    price: '25.000',
    discount: '5.000',
    net: '20.000',
    effective_bps: 2000,
    performer_ids: [employeeId],
    requested_by: f.userId,
    requested_by_membership_id: f.membership,
  };
  await f.h.owner`INSERT INTO employee_branches(company_id,id,business_id,employee_id,branch_id,"from")
    VALUES(${f.company},${ids.newId()},${f.business},${employeeId},${branchId},'2026-01-01') ON CONFLICT DO NOTHING`;
  await f.h.owner`INSERT INTO discount_proposals(company_id,id,business_id,branch_id,request_id,input_index,kind,session_id,occurred_at,
    customer_id,service_id,service_name_en,service_name_ar,terms,terms_hash,effective_bps,requested_by,requested_by_membership_id,
    requester_limit_source,requester_limit_bps,requester_name_ar,requester_name_en,requester_role,requester_role_is_system,
    requester_role_name_ar,requester_role_name_en,requester_first_name_en,requester_first_name_ar,customer_first_name,requested_at,status,expires_at)
    VALUES(${f.company},${proposalId},${f.business},${branchId},${ids.newId()},0,'RECORD',NULL,
      ${seed.requestedAt}::timestamptz,${f.customer},${must(f.services[0])},'Synthetic service 0',NULL,
      ${JSON.stringify(terms)}::text::jsonb,
      ${'a'.repeat(64)},2000,${f.userId},${f.membership},'PERSON',1000,NULL,NULL,'cashier',true,NULL,'Cashier',NULL,NULL,'Synthetic',
      ${seed.requestedAt}::timestamptz,'PENDING',${seed.expiresAt}::timestamptz)`;
  await f.h.owner`INSERT INTO discount_proposal_performers(company_id,id,business_id,proposal_id,employee_id,linked_user_id,first_name_en,first_name_ar)
    VALUES(${f.company},${ids.newId()},${f.business},${proposalId},${employeeId},${f.performerUserId},'Sara','سارة')`;
  return proposalId;
}
