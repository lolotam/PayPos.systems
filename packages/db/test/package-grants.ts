// تخزين بيع الباقات وطلبات البيع المعلقة: إدخال وقراءة فقط ولا حذف، والتحديث على أعمدة مسماة وبس.
export const PACKAGE_TABLE_GRANTS = [
  'package_components:INSERT',
  'package_components:SELECT',
  'package_entitlements:INSERT',
  'package_entitlements:SELECT',
  'package_redemptions:INSERT',
  'package_redemptions:SELECT',
  'package_sale_requests:INSERT',
  'package_sale_requests:SELECT',
  'package_session_slots:INSERT',
  'package_session_slots:SELECT',
];

// منح الحالة والمؤشر تدعم FREE وUSED المحروسين في 43-1؛ تغيير الانتهاء والمبلغ المسترد والمراجعة يظل مقفولًا حتى 45 و46-1.
export const PACKAGE_COLUMN_GRANTS = [
  'package_redemptions.reversal_cancellation_id:pospay_app:UPDATE',
  'package_redemptions.reversed_at:pospay_app:UPDATE',
  // طلب البيع المعلق: العامل بيكتب النتيجة بس، وجسم الطلب يفضل مقفول (42-3b1a).
  'package_sale_requests.entitlement_id:pospay_app:UPDATE',
  'package_sale_requests.error_code:pospay_app:UPDATE',
  'package_sale_requests.error_details:pospay_app:UPDATE',
  'package_sale_requests.finished_at:pospay_app:UPDATE',
  'package_sale_requests.status:pospay_app:UPDATE',
  'package_components.lock_touch:pospay_app:UPDATE',
  'package_entitlements.expires_on:pospay_app:UPDATE',
  'package_entitlements.refunded_amount:pospay_app:UPDATE',
  'package_entitlements.revision:pospay_app:UPDATE',
  'package_session_slots.current_redemption_id:pospay_app:UPDATE',
  'package_session_slots.state:pospay_app:UPDATE',
];
