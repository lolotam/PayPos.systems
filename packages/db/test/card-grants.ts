// كود الكارت يبقى ثابتاً بعد الإصدار؛ pospay_app يعدّل حقول الإلغاء فقط.
export const CARD_COLUMN_GRANTS = [
  'employee_cards.revoked_at:pospay_app:UPDATE',
  'employee_cards.revoked_by:pospay_app:UPDATE',
];
