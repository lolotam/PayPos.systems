import type { EmployeeDocumentFormValues } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';

/** خانة رقم المستند الاختياري وخطؤها المحلي؛ استُخرجت لإبقاء النموذج تحت سقف طول الدالة. */
export function DocumentNumberField({
  locale,
  numberInvalid,
  register,
}: {
  locale: 'ar' | 'en';
  numberInvalid: boolean;
  register: UseFormRegister<EmployeeDocumentFormValues>;
}) {
  return (
    <>
      <Label htmlFor="document-number">{t(locale, 'employeeDocuments.documentNumber')}</Label>
      <Input id="document-number" type="text" autoComplete="off" {...register('document_number')} />
      {numberInvalid ? (
        <p role="alert" className="text-sm text-destructive">
          {t(locale, 'employeeDocuments.numberInvalid')}
        </p>
      ) : null}
    </>
  );
}
