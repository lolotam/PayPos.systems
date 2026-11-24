'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  createBusinessInput,
  type Country,
  type CreateBusinessInput,
  type CreateBusinessRequest,
} from '@pospay/contracts';
import type { MessageKey } from '@pospay/i18n';
import { t } from '@pospay/i18n';
import { Button, Label, Select } from '@pospay/ui';
import { useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import type { FieldError } from 'react-hook-form';

import { useLocale } from '@/shared/locale/locale-context';

import type { CreateBusinessWire } from '../api/create-business-client';
import { countryOptions, verticalOptions } from './first-setup-options';
import { NameField } from './name-field';

function nameErrorKey(issue: FieldError | undefined, empty: boolean): MessageKey | undefined {
  if (!issue) return undefined;
  return empty ? 'admin.businessNameRequired' : 'admin.nameTooLong';
}

function serverError(
  serverField: 'name_en' | 'name_ar' | null,
  which: 'name_en' | 'name_ar',
): MessageKey | undefined {
  return serverField === which ? 'admin.nameTooLong' : undefined;
}

// الاسم العربي الفاضي بيتحوّل لغياب قبل الإرسال زي شاشة الشركة، عشان حقل العقد الاختياري يقبله.
const omitEmptyArabic = (value: string) => {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

function wireOf(input: CreateBusinessInput, country: Country): {
  body: CreateBusinessWire;
  country: Country;
} {
  return {
    body: { vertical_type: input.vertical_type, name_en: input.name_en, name_ar: input.name_ar },
    country,
  };
}

// مُساعد رسم مش مكوّن: سطر واحد مكان بلوك الـ Controller داخل الدالة اللي عليها حد الـ 60 سطر.
function verticalSelect(
  locale: ReturnType<typeof useLocale>,
  control: Control<CreateBusinessRequest>,
  pending: boolean,
) {
  return (
    <Controller
      name="vertical_type"
      control={control}
      render={({ field }) => (
        <Select
          id="first-business-type"
          value={field.value}
          onValueChange={field.onChange}
          options={verticalOptions(locale)}
          disabled={pending}
        />
      )}
    />
  );
}

export function CreateFirstBusinessForm({
  pending,
  serverField,
  onSave,
}: {
  pending: boolean;
  serverField: 'name_en' | 'name_ar' | null;
  onSave: (call: { body: CreateBusinessWire; country: Country }) => void;
}) {
  const locale = useLocale();
  const [country, setCountry] = useState<Country>('KW');
  const form = useForm<CreateBusinessRequest, unknown, CreateBusinessInput>({
    resolver: zodResolver(createBusinessInput),
    defaultValues: { vertical_type: 'salon', name_en: '', name_ar: undefined },
  });
  const errors = form.formState.errors;
  const enError = nameErrorKey(errors.name_en, form.getValues().name_en.trim() === '');
  const arError = errors.name_ar ? 'admin.nameTooLong' : undefined;
  return (
    <form
      noValidate
      method="post"
      className="flex flex-col gap-4 text-start"
      onSubmit={form.handleSubmit((input) => onSave(wireOf(input, country)))}
    >
      <fieldset disabled={pending} className="contents">
        <Label htmlFor="first-business-type">{t(locale, 'admin.businessTypeLabel')}</Label>
        {verticalSelect(locale, form.control, pending)}
        <NameField
          id="first-business-name-en"
          label="admin.businessNameEnLabel"
          error={enError ?? serverError(serverField, 'name_en')}
          disabled={pending}
          {...form.register('name_en')}
        />
        <NameField
          id="first-business-name-ar"
          label="admin.businessNameArLabel"
          error={arError ?? serverError(serverField, 'name_ar')}
          disabled={pending}
          {...form.register('name_ar', { setValueAs: omitEmptyArabic })}
        />
        <Label htmlFor="first-business-country">{t(locale, 'admin.businessCountryLabel')}</Label>
        <Select
          id="first-business-country"
          value={country}
          onValueChange={(next) => setCountry(next as Country)}
          options={countryOptions(locale)}
          disabled={pending}
        />
        <Button type="submit" disabled={pending}>
          {t(locale, 'admin.firstBusinessSubmit')}
        </Button>
      </fieldset>
    </form>
  );
}
