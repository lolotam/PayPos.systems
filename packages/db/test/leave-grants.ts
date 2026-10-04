// تعديل الطلب محصور في إلغاء معلق؛ الهوية والفترة ومعلومات القرار لا تقبل تحديث التطبيق هنا.
export const LEAVE_COLUMN_GRANTS = [
  'leave_requests.cancelled_at:pospay_app:UPDATE',
  'leave_requests.cancelled_by:pospay_app:UPDATE',
  'leave_requests.revision:pospay_app:UPDATE',
  'leave_requests.status:pospay_app:UPDATE',
];
