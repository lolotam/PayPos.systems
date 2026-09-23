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
