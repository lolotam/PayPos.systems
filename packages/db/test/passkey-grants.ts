// ربط الموظف يحتفظ بتاريخه؛ المدير يعدل الفك والنسخة فقط ولا يبدل الاعتماد.
export const PASSKEY_COLUMN_GRANTS = [
  'employee_passkeys.revision:pospay_app:UPDATE',
  'employee_passkeys.unbound_at:pospay_app:UPDATE',
  'employee_passkeys.unbound_by:pospay_app:UPDATE',
  // بند 21b: قفل التثبيت يكتب مرة واحدة (trigger) عند التسجيل أو أول بصمة مقبولة.
  'employee_passkeys.installation_hash:pospay_app:UPDATE',
  'employee_passkeys.installation_locked_at:pospay_app:UPDATE',
];
