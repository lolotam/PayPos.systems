'use client';

import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';
import { useState, type FormEvent } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { acceptableLogoFile } from '../model/logo-file';

export function LogoFileForm({
  logoId,
  pending,
  onUpload,
  onAskRemove,
}: {
  logoId: string | null;
  pending: boolean;
  onUpload: (file: File) => void;
  onAskRemove: () => void;
}) {
  const locale = useLocale();
  const [file, setFile] = useState<File | null>(null);
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!file || !acceptableLogoFile(file)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onUpload(file);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Label htmlFor="business-logo-file">{t(locale, 'businessIdentity.logoFile')}</Label>
      <Input
        id="business-logo-file"
        type="file"
        accept="image/png,image/jpeg"
        disabled={pending}
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {t(locale, logoId ? 'businessIdentity.replace' : 'businessIdentity.upload')}
        </Button>
        {logoId ? (
          <Button type="button" variant="outline" disabled={pending} onClick={onAskRemove}>
            {t(locale, 'businessIdentity.remove')}
          </Button>
        ) : null}
      </div>
      {invalid ? <p role="alert">{t(locale, 'businessIdentity.invalidFile')}</p> : null}
    </form>
  );
}
