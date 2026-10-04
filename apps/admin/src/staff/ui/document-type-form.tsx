'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  createDocumentTypeInput,
  type CreateDocumentTypeInput,
  type DocumentType,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { DocumentTypeRuleFields } from './document-type-rule-fields';

const emptyToNull = (value: string | null) =>
  value === null || value.trim() === '' ? null : value;

export function DocumentTypeForm({
  type,
  pending,
  onSave,
  onCancel,
}: {
  type?: DocumentType;
  pending: boolean;
  onSave: (input: CreateDocumentTypeInput) => void;
  onCancel?: () => void;
}) {
  const locale = useLocale();
  const form = useForm<CreateDocumentTypeInput>({
    resolver: zodResolver(createDocumentTypeInput),
    defaultValues: {
      name_en: type?.name_en ?? '',
      name_ar: type?.name_ar ?? null,
      alert_days: type?.alert_days ?? 30,
      requires_expiry: type?.requires_expiry ?? true,
    },
  });
  const id = type?.id ?? 'new';
  return (
    <form onSubmit={form.handleSubmit(onSave)} className="flex flex-col gap-3 text-start">
      <fieldset disabled={pending} className="flex flex-col gap-3">
        <Label htmlFor={`type-name-en-${id}`}>{t(locale, 'employeeDocuments.nameEn')}</Label>
        <Input id={`type-name-en-${id}`} maxLength={255} {...form.register('name_en')} />
        <Label htmlFor={`type-name-ar-${id}`}>{t(locale, 'employeeDocuments.nameAr')}</Label>
        <Input
          id={`type-name-ar-${id}`}
          maxLength={255}
          {...form.register('name_ar', { setValueAs: emptyToNull })}
        />
        <DocumentTypeRuleFields id={id} register={form.register} />
        <div className="flex gap-2">
          <Button type="submit">
            {t(locale, type ? 'employeeDocuments.save' : 'employeeDocuments.add')}
          </Button>
          {onCancel ? (
            <Button type="button" variant="outline" onClick={onCancel}>
              {t(locale, 'employeeDocuments.cancel')}
            </Button>
          ) : null}
        </div>
      </fieldset>
      {Object.keys(form.formState.errors).length > 0 ? (
        <p role="alert">{t(locale, 'employeeDocuments.typeInvalid')}</p>
      ) : null}
    </form>
  );
}
