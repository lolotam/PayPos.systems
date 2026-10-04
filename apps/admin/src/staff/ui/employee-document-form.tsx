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
import { DocumentTypeField } from './document-type-field';

export function EmployeeDocumentForm({
  types,
  typeCode,
  pending,
  onSubmit,
}: {
  types: DocumentType[];
  typeCode?: string;
  pending: boolean;
  onSubmit: (submission: DocumentSubmission) => void;
}) {
  const locale = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [invalid, setInvalid] = useState(false);
  const form = useForm<EmployeeDocumentFormValues>({
    resolver: zodResolver(employeeDocumentFormInput),
    defaultValues: { type_code: typeCode ?? types[0]?.code ?? '', expires_on: '' },
  });
  const code = useWatch({ control: form.control, name: 'type_code' });
  const requiresExpiry = types.find((type) => type.code === code)?.requires_expiry ?? false;
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
        <Label htmlFor="document-expires">{t(locale, 'employeeDocuments.expiresOn')}</Label>
        <Input id="document-expires" type="date" {...form.register('expires_on')} />
        <p className="text-sm text-muted-foreground">
          {t(
            locale,
            requiresExpiry
              ? 'employeeDocuments.expiryRequired'
              : 'employeeDocuments.expiryOptional',
          )}
        </p>
        <Button type="submit">{t(locale, 'employeeDocuments.upload')}</Button>
      </fieldset>
      {invalid || Object.keys(form.formState.errors).length > 0 ? (
        <p role="alert">{t(locale, 'employeeDocuments.invalid')}</p>
      ) : null}
    </form>
  );
}
