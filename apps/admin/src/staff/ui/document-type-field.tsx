'use client';
import type { DocumentType } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Label, NativeSelect } from '@pospay/ui';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';

export function DocumentTypeField({
  types,
  registration,
}: {
  types: DocumentType[];
  registration: UseFormRegisterReturn<'type_code'>;
}) {
  const locale = useLocale();
  return (
    <>
      <Label htmlFor="document-type">{t(locale, 'employeeDocuments.type')}</Label>
      <NativeSelect id="document-type" {...registration}>
        {types.map((type) => (
          <option key={type.id} value={type.code}>
            {locale === 'ar' ? (type.name_ar ?? type.name_en) : type.name_en}
          </option>
        ))}
      </NativeSelect>
    </>
  );
}
