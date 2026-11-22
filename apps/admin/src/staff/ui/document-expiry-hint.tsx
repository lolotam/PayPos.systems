import { t } from '@pospay/i18n';

/** تنبيه حالة الانتهاء: إلزامي أو اختياري حسب نوع الوثيقة. */
export function ExpiryHint({
  locale,
  requiresExpiry,
}: {
  locale: 'ar' | 'en';
  requiresExpiry: boolean;
}) {
  return (
    <p className="text-sm text-muted-foreground">
      {t(
        locale,
        requiresExpiry ? 'employeeDocuments.expiryRequired' : 'employeeDocuments.expiryOptional',
      )}
    </p>
  );
}
