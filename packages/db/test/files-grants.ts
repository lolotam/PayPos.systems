// أعمدة الفحص فقط قابلة للتحديث؛ الملكية والصلاحية ومفتاح الرفع ثابتة.
export const FILE_COLUMN_GRANTS = [
  'file_objects.confirmed_at:pospay_app:UPDATE',
  'file_objects.rejected_at:pospay_app:UPDATE',
  'file_objects.purge_started_at:pospay_app:UPDATE',
  'file_objects.purged_at:pospay_app:UPDATE',
  'file_objects.content_type:pospay_app:UPDATE',
  'file_objects.lease_id:pospay_app:UPDATE',
  'file_objects.lease_until:pospay_app:UPDATE',
  'file_objects.rejection_code:pospay_app:UPDATE',
  'file_objects.size_bytes:pospay_app:UPDATE',
  'file_objects.status:pospay_app:UPDATE',
  'file_objects.storage_key:pospay_app:UPDATE',
];
