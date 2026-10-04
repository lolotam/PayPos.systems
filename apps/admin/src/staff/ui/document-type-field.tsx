'use client';
import type { DocumentType, EmployeeDocumentFormValues } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import type { UseFormRegister } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function DocumentTypeField({
  types,
  register,
}: {
  types: DocumentType[];
  register: UseFormRegister<EmployeeDocumentFormValues>;
}) {
  const locale = useLocale();
  return (
    <>
      <Label htmlFor="document-type">{t(locale, 'employeeDocuments.type')}</Label>
      <NativeSelect id="document-type" {...register('type_code')}>
        {types.map((type) => (
          <option key={type.id} value={type.code}>
            {locale === 'ar' ? (type.name_ar ?? type.name_en) : type.name_en}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}
