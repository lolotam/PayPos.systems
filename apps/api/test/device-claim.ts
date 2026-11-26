/**
 * تسجيل الجهاز بيرجّع كود المطابقة كمان، وطلب المطالبة بياخد تلات حقول بس.
 * الـ fixtures كانت بتبعث الرد كله، فبتبعت التلاتة بس من هنا.
 */
export interface DeviceClaimRecord {
  readonly company_id: string;
  readonly device_id: string;
  readonly claim_secret: string;
}

export function claimPayload(device: DeviceClaimRecord): DeviceClaimRecord {
  return {
    company_id: device.company_id,
    device_id: device.device_id,
    claim_secret: device.claim_secret,
  };
}
