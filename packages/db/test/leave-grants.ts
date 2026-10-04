// التعديل محصور في دورة الحالة والقرار والسحب؛ الهوية والفترة لا يقبلان تحديث التطبيق.
export const LEAVE_COLUMN_GRANTS = [
  'leave_requests.cancelled_at:pospay_app:UPDATE',
  'leave_requests.cancelled_by:pospay_app:UPDATE',
  'leave_requests.revision:pospay_app:UPDATE',
  'leave_requests.status:pospay_app:UPDATE',
  'leave_requests.decided_by:pospay_app:UPDATE',
  'leave_requests.decided_at:pospay_app:UPDATE',
  'leave_requests.rejection_reason:pospay_app:UPDATE',
  'leave_requests.decision_reason:pospay_app:UPDATE',
  'leave_requests.revoked_by:pospay_app:UPDATE',
  'leave_requests.revoked_at:pospay_app:UPDATE',
  'leave_requests.revocation_reason:pospay_app:UPDATE',
];
