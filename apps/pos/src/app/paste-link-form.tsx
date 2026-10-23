import { useState, type FormEvent } from 'react';

import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { readManagerLink, type PersonalWorkspace } from './manager-link';

export function PasteLinkForm({
  onConnect,
}: {
  onConnect: (workspace: PersonalWorkspace) => void;
}) {
  const locale = useLocale();
  const [value, setValue] = useState('');
  const [refused, setRefused] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const workspace = readManagerLink(value);
    if (workspace === null) {
      setRefused(true);
      return;
    }
    setRefused(false);
    onConnect(workspace);
  };
  // التحقق بتاع المتصفح مش هينفع هنا: هو هيبقي رسالة المتصفح جوه الحقل، والرسالة اللي
  // الموظفة لازم تشوفها هي «اطلب من المدير» (FR-012).
  return (
    <form className="grid gap-2" noValidate onSubmit={submit}>
      <Label htmlFor="manager-link">{t(locale, 'nativeShell.pasteLabel')}</Label>
      <Input
        id="manager-link"
        type="url"
        dir="ltr"
        autoComplete="off"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {refused ? <p role="alert">{t(locale, 'personalStaff.linkRequired')}</p> : null}
      <Button type="submit">{t(locale, 'nativeShell.pasteSubmit')}</Button>
    </form>
  );
}
