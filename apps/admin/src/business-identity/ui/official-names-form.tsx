'use client';

import type { UpdateBusinessIdentityNamesInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useEffect, useRef, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import {
  changedOfficialNames,
  type NameDraft,
  type OfficialNames,
} from '../model/changed-official-names';

const NAME_FIELDS = ['official_name_ar', 'official_name_en'] as const;

function syncOfficialNames(
  form: UseFormReturn<NameDraft>,
  baseline: OfficialNames,
  saved: OfficialNames | null,
  appliedSave: { current: OfficialNames | null },
) {
  if (saved && saved !== appliedSave.current) {
    appliedSave.current = saved;
    form.reset({
      official_name_ar: saved.official_name_ar ?? '',
      official_name_en: saved.official_name_en ?? '',
    });
    return;
  }
  const next: NameDraft = {
    official_name_ar: baseline.official_name_ar ?? '',
    official_name_en: baseline.official_name_en ?? '',
  };
  for (const key of NAME_FIELDS) {
    if (form.getFieldState(key).isDirty) continue;
    if (form.getValues(key) === next[key]) continue;
    form.resetField(key, { defaultValue: next[key] });
  }
}

export function OfficialNamesForm({
  baseline,
  saved,
  pending,
  onSave,
}: {
  baseline: OfficialNames | null;
  /** صف الهوية بعد refreshBusinessIdentity، مش جسم الـ PATCH، عشان اسم أدمن تاني ما يترجعش. */
  saved: OfficialNames | null;
  pending: boolean;
  onSave: (body: UpdateBusinessIdentityNamesInput) => void;
}) {
  const locale = useLocale();
  const [notice, setNotice] = useState<'invalid' | 'unchanged' | null>(null);
  const appliedSave = useRef<OfficialNames | null>(null);
  const form = useForm<NameDraft>({
    defaultValues: {
      official_name_ar: baseline?.official_name_ar ?? '',
      official_name_en: baseline?.official_name_en ?? '',
    },
  });
  const baselineAr = baseline?.official_name_ar ?? null;
  const baselineEn = baseline?.official_name_en ?? null;
  const dirty = form.formState.dirtyFields;
  useEffect(() => {
    syncOfficialNames(
      form,
      { official_name_ar: baselineAr, official_name_en: baselineEn },
      saved,
      appliedSave,
    );
  }, [form, baselineAr, baselineEn, saved]);
  const submit = form.handleSubmit((draft) => {
    const change = changedOfficialNames(draft, baseline, dirty);
    if (!change.ok) {
      setNotice(change.reason === 'invalid' ? 'invalid' : 'unchanged');
      return;
    }
    setNotice(null);
    onSave(change.body);
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 text-start">
      <Label htmlFor="official-name-ar">{t(locale, 'businessIdentity.nameAr')}</Label>
      <Input id="official-name-ar" {...form.register('official_name_ar')} disabled={pending} />
      <Label htmlFor="official-name-en">{t(locale, 'businessIdentity.nameEn')}</Label>
      <Input id="official-name-en" {...form.register('official_name_en')} disabled={pending} />
      {notice ? (
        <p role="alert">
          {t(
            locale,
            notice === 'invalid' ? 'businessIdentity.invalid' : 'businessIdentity.unchanged',
          )}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t(locale, 'businessIdentity.save')}
      </Button>
    </form>
  );
}
