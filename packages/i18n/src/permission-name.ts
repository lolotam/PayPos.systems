import { t, type Locale, type MessageKey } from './catalog.js';

const keys: Readonly<Record<string, MessageKey>> = {
  'read:memberships:company': 'permissionCodes.readMembershipsCompany',
  'manage:memberships:company': 'permissionCodes.manageMembershipsCompany',
  'read:memberships:business': 'permissionCodes.readMembershipsBusiness',
  'manage:memberships:business': 'permissionCodes.manageMembershipsBusiness',
  'read:businesses:company': 'permissionCodes.readBusinessesCompany',
  'create:businesses:company': 'permissionCodes.createBusinessesCompany',
  'create:branches:business': 'permissionCodes.createBranchesBusiness',
  'read:branches:branch': 'permissionCodes.readBranchesBranch',
  'manage:devices:branch': 'permissionCodes.manageDevicesBranch',
  'read:settings:business': 'permissionCodes.readSettingsBusiness',
  'manage:settings:business': 'permissionCodes.manageSettingsBusiness',
  'view:notifications:business': 'permissionCodes.viewNotificationsBusiness',
  'manage:files:business': 'permissionCodes.manageFilesBusiness',
  'read:files:business': 'permissionCodes.readFilesBusiness',
  'manage:employees:business': 'permissionCodes.manageEmployeesBusiness',
  'manage:discounts:company': 'permissionCodes.manageDiscountsCompany',
  'create:customers:company': 'permissionCodes.createCustomersCompany',
  'login:staff:branch': 'permissionCodes.loginStaffBranch',
  'create:companies:platform': 'permissionCodes.createCompaniesPlatform',
};

/** اسم الصلاحية المحلي مع بقاء الكود متاحاً للتدقيق؛ الأكواد غير المعروفة تحتفظ بقيمتها. */
export function permissionName(locale: Locale, code: string): string {
  const key = keys[code];
  return key === undefined ? code : t(locale, key);
}
