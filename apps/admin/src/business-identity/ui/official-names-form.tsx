'use client';

import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import type { UpdateBusinessIdentityNamesInput } from '@pospay/contracts';
import {
  changedOfficialNames,
  type NameDraft,
  type OfficialNames,
} from '../model/changed-official-names';

export function OfficialNamesForm({
  baseline,
  pending,
  onSave,
}: {
  baseline: OfficialNames | null;
  pending: boolean;
  onSave: (body: UpdateBusinessIdentityNamesInput) => void;
}) {
  const locale = useLocale();
  const [notice, setNotice] = useState<'invalid' | 'unchanged' | null>(null);
  const form = useForm<NameDraft>({
    defaultValues: {
      official_name_ar: baseline?.official_name_ar ?? '',
      official_name_en: baseline?.official_name_en ?? '',
    },
  });
  const dirty = form.formState.dirtyFields;
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
