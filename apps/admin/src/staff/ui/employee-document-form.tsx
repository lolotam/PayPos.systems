'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  employeeDocumentFormInput,
  type DocumentType,
  type EmployeeDocumentFormValues,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { DocumentSubmission } from '../api/use-employee-documents';
import { acceptableDocumentFile } from '../model/document-file';
import { ExpiryHint } from './document-expiry-hint';
import { DocumentNumberField } from './document-number-field';
import { DocumentTypeField } from './document-type-field';

type EmployeeDocumentFormProps = {
  types: DocumentType[];
  typeCode?: string;
  pending: boolean;
  initialNumber?: string;
  onSubmit: (submission: DocumentSubmission) => void;
};

export function EmployeeDocumentForm({
  types,
  typeCode,
  pending,
  initialNumber = '',
  onSubmit,
}: EmployeeDocumentFormProps) {
  const locale = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [invalid, setInvalid] = useState(false);
  const form = useForm<EmployeeDocumentFormValues>({
    resolver: zodResolver(employeeDocumentFormInput),
    defaultValues: {
      type_code: typeCode ?? types[0]?.code ?? '',
      expires_on: '',
      document_number: initialNumber,
    },
  });
  const code = useWatch({ control: form.control, name: 'type_code' });
  const requiresExpiry = types.find((type) => type.code === code)?.requires_expiry ?? false;
  // خطأ رقم المستند بيظهر محليًا جنب الخانة نفسها؛ التنبيه العام لمصالح الوثيقة التانية بس.
  const numberInvalid = form.formState.errors.document_number !== undefined;
  const otherInvalid =
    invalid || Object.keys(form.formState.errors).some((key) => key !== 'document_number');
  const submit = form.handleSubmit((values) => {
    const missingExpiry = requiresExpiry && values.expires_on === '';
    setInvalid(!acceptableDocumentFile(file) || missingExpiry);
    if (acceptableDocumentFile(file) && !missingExpiry) onSubmit({ file, values });
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 text-start">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <DocumentTypeField types={types} register={form.register} />
        <Label htmlFor="document-file">{t(locale, 'employeeDocuments.file')}</Label>
        <Input
          id="document-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <DocumentNumberField
          locale={locale}
          numberInvalid={numberInvalid}
          register={form.register}
        />
        <Label htmlFor="document-expires">{t(locale, 'employeeDocuments.expiresOn')}</Label>
        <Input id="document-expires" type="date" {...form.register('expires_on')} />
        <ExpiryHint locale={locale} requiresExpiry={requiresExpiry} />
        <Button type="submit">{t(locale, 'employeeDocuments.upload')}</Button>
      </fieldset>
      {invalid || otherInvalid ? (
        <p role="alert">{t(locale, 'employeeDocuments.invalid')}</p>
      ) : null}
    </form>
  );
}
