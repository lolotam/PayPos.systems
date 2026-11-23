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
 * بيتبعت في نفس معاملة اكتمال «إعطاء الدخول» (خطوة 3): العضوية والربط والرقم المؤقت والسجل صاروا
 * ACTIVE — والتكرار بعد النجاح ما بيبعتش الحدث تاني (FR-F1-4). الحمولة معرّفات بس: مفيش هاتف ولا PIN.
 */
export interface StaffAccessGranted {
  readonly employee_id: string;
  readonly user_id: string;
  readonly membership_id: string;
  readonly branch_id: string;
  readonly role: 'staff' | 'reception';
}

export const STAFF_ACCESS_GRANTED = 'StaffAccessGranted';

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
  eventType: string;
  aggregateType: string;
  payload: StaffAccessGranted;
} {
  return { eventType: STAFF_ACCESS_GRANTED, aggregateType: STAFF_ACCESS_AGGREGATE, payload };
}
