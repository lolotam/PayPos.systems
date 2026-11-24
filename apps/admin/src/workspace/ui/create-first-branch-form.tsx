'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { createBranchInput, type CreateBranchInput } from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useForm } from 'react-hook-form';
import type { FieldError } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import type { CreateBranchWire } from '../api/create-branch-client';
import { NameField } from './name-field';

function branchErrorKey(issue: FieldError | undefined, empty: boolean): MessageKey | undefined {
  if (!issue) return undefined;
  return empty ? 'admin.branchNameRequired' : 'admin.nameTooLong';
}

// الاسم العربي الفاضي بيتحوّل لغياب قبل الإرسال زي شاشة الشركة، عشان حقل العقد الاختياري يقبله.
const omitEmptyArabic = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export function CreateFirstBranchForm({
  pending,
  serverField,
  onSave,
}: {
  pending: boolean;
  serverField: 'name_en' | 'name_ar' | null;
  onSave: (body: CreateBranchWire) => void;
}) {
  const locale = useLocale();
  const form = useForm<CreateBranchInput>({
    resolver: zodResolver(createBranchInput),
    defaultValues: { name_en: '', name_ar: undefined },
  });
  const errors = form.formState.errors;
  const values = form.getValues();
  const enError = branchErrorKey(errors.name_en, values.name_en.trim() === '');
  const arError = errors.name_ar ? 'admin.nameTooLong' : undefined;
  return (
    <form
      noValidate
      method="post"
      className="flex flex-col gap-4 text-start"
      onSubmit={form.handleSubmit((input) => onSave({ name_en: input.name_en, name_ar: input.name_ar }))}
    >
      <fieldset disabled={pending} className="contents">
        <NameField
          id="first-branch-name-en"
          label="admin.branchNameEnLabel"
          error={enError ?? (serverField === 'name_en' ? 'admin.nameTooLong' : undefined)}
          disabled={pending}
          {...form.register('name_en')}
        />
        <NameField
          id="first-branch-name-ar"
          label="admin.branchNameArLabel"
          error={arError ?? (serverField === 'name_ar' ? 'admin.nameTooLong' : undefined)}
          disabled={pending}
          {...form.register('name_ar', { setValueAs: omitEmptyArabic })}
        />
        <Button type="submit" disabled={pending}>
          {t(locale, 'admin.firstBranchSubmit')}
        </Button>
      </fieldset>
    </form>
  );
}
