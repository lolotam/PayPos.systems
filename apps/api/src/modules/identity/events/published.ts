/**
 * بيتبعت مرة واحدة لما شركة جديدة تتسجل ومعاها عضوية الـ Owner الأولى، في نفس الـ transaction (onboard-company).
 */
export interface CompanyCreated {
  readonly company_id: string;
  readonly owner_user_id: string;
  readonly plan_id: string;
}

export const COMPANY_CREATED = 'CompanyCreated';

/**
 * بيتبعت لما جهاز يتسجل بكود pairing صالح ويستنى موافقة الـ manager (register-device).
 */
export interface DeviceRegistered {
  readonly device_id: string;
  readonly branch_id: string;
  readonly company_id: string;
}

/**
 * بيتبعت لما manager يلغي جهاز — التوكن بتاعه اتمسح، وأول اتصال بعدها مرفوض (revoke-device).
 */
export interface DeviceRevoked {
  readonly device_id: string;
  readonly branch_id: string;
  readonly company_id: string;
}

export const DEVICE_REGISTERED = 'DeviceRegistered';
export const DEVICE_REVOKED = 'DeviceRevoked';

/**
 * بيتبعت مرة واحدة لما مالك الشركة يدعو عضو جديد، في نفس الـ transaction اللي كاتب العضوية
 * (invite-member). مفيش إيميل ولا رابط ولا token في الـ payload.
 */
export interface MemberInvited {
  readonly invitation_id: string;
  readonly user_id: string;
  readonly membership_id: string;
  readonly role_code: string;
  readonly scope_type: string;
  readonly scope_id: string;
  readonly invited_by: string;
}

export const MEMBER_INVITED = 'MemberInvited';

/**
 * بيتبعت في نفس معاملة اكتمال «إعطاء الدخول» (خطوة 3): العضوية والربط والرقم المؤقت والسجل صاروا
 * ACTIVE — والتكرار بعد النجاح ما بيبعتش الحدث تاني (FR-F1-4). الحمولة معرّفات بس: مفيش هاتف ولا PIN.
 * `actor_user_id` المانح و`occurred_at` لحظة الإعطاء بيتثبتوا في الحدث نفسه، فالإشعار ما بيتأثرش
 * بتغيّر لاحق في السجل؛ وهما اختياريان عشان أحداث أقدم في الطابور ما فيهاش القيمتين.
 */
export interface StaffAccessGranted {
  readonly employee_id: string;
  readonly user_id: string;
  readonly membership_id: string;
  readonly branch_id: string;
  readonly role: 'staff' | 'reception';
  readonly actor_user_id?: string;
  readonly occurred_at?: string;
}

export const STAFF_ACCESS_GRANTED = 'StaffAccessGranted';

/**
 * بيتبعت في نفس معاملة إعادة ضبط الرقم السري لموظفة من غير نفسها (F2b): الرقم اتغيّر
 * والرقم القديم بقى منتهي — الحمولة معرّفات بس: مفيش رقم سري ولا hash ولا هاتف.
 * `actor_user_id` من أعاد الضبط و`occurred_at` لحظته بيتثبتوا في الحدث نفسه (اختياريان للأحداث الأقدم).
 */
export interface StaffPinSetByOther {
  readonly employee_id: string;
  readonly user_id: string;
  readonly branch_id: string;
  readonly actor_user_id?: string;
  readonly occurred_at?: string;
}

export const STAFF_PIN_SET_BY_OTHER = 'StaffPinSetByOther';

/** اسم الـ aggregate اللي الحدث بيتعلق بيه في الـ outbox. */
export const STAFF_ACCESS_AGGREGATE = 'employee';

/**
 * بيبنى حمولة الحدث باسمه الثابت — staff بينادي الدالة دي (النداء الشرط الوحيد لاستيراد قيمة من
 * موديول تاني) والاسم يفضل مصدره واحد في identity.
 *
 * @param payload معرّفات الموظفة والمستخدم والعضوية والفرع والدور
 * @returns الحدث جاهز لصف الـ outbox: النوع والحمولة
 */
export function staffAccessGrantedEvent(payload: StaffAccessGranted): {
  eventType: typeof STAFF_ACCESS_GRANTED;
  aggregateType: typeof STAFF_ACCESS_AGGREGATE;
  payload: StaffAccessGranted;
} {
  return { eventType: STAFF_ACCESS_GRANTED, aggregateType: STAFF_ACCESS_AGGREGATE, payload };
}

/**
 * بيبنى حمولة إعادة ضبط الرقم السري بنفس اسمها الثابت — staff بينادي الدالة دي (النداء الشرط
 * الوحيد لاستيراد قيمة من موديول تاني) والاسم يفضل مصدره واحد في identity.
 *
 * @param payload معرّفات الموظفة والمستخدم والفرع
 * @returns الحدث جاهز لصف الـ outbox: النوع والحمولة
 */
export function staffPinSetByOtherEvent(payload: StaffPinSetByOther): {
  eventType: typeof STAFF_PIN_SET_BY_OTHER;
  aggregateType: typeof STAFF_ACCESS_AGGREGATE;
  payload: StaffPinSetByOther;
} {
  return { eventType: STAFF_PIN_SET_BY_OTHER, aggregateType: STAFF_ACCESS_AGGREGATE, payload };
}
