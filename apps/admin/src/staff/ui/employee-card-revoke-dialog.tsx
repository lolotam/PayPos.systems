'use client';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { ModalDialog } from '@/shared/ui/modal-dialog';

// تأكيد صريح قبل إلغاء الكارت النشط لأن الإجراء فوري ولا يُرجَع في سجل التدقيق.
export function EmployeeCardRevokeDialog({
  locale,
  onConfirm,
  onClose,
}: {
  locale: Locale;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <ModalDialog
      title={t(locale, 'employeeCard.revokeConfirmTitle')}
      pending={false}
      onClose={onClose}
      className="max-w-md"
    >
      <p className="text-sm text-muted-foreground">{t(locale, 'employeeCard.revokeConfirmBody')}</p>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          {t(locale, 'employeeCard.revokeCancel')}
        </Button>
        <Button type="button" variant="destructive" onClick={onConfirm}>
          {t(locale, 'employeeCard.revokeConfirm')}
        </Button>
      </div>
    </ModalDialog>
  );
}
