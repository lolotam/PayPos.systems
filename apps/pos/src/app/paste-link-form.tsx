import { useState, type FormEvent } from 'react';

import { t } from '@pospay/i18n';
import { Button, Input, Label } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import { capabilities } from '@/shared/platform/native-shell';
import { WebOnlyNotice } from '@/shared/platform/web-only-notice';

import { readManagerLink, type PersonalWorkspace } from './manager-link';
import { PasteLinkScan } from './paste-link-scan';

/** نوع التنبيه المعروض: طلب لينك من المدير، أو الكاميرا اترفضت. */
type PasteAlert = 'link' | 'camera';

export function PasteLinkForm({
  onConnect,
  locked = false,
}: {
  onConnect: (workspace: PersonalWorkspace) => void;
  locked?: boolean;
}) {
  const locale = useLocale();
  const [value, setValue] = useState('');
  const [alert, setAlert] = useState<PasteAlert | null>(null);
  // المسح بالكاميرا من قدرات البناء وحدها: نسخة التطبيق الأصلي بتقفله حسب البناء،
  // ونسخة الويب (PWA) مفتوحة دايماً (FR-014).
  const qrScan = capabilities().qrScan;

  const connect = (raw: string): void => {
    const workspace = readManagerLink(raw);
    if (workspace === null) {
      setAlert('link');
      return;
    }
    setAlert(null);
    onConnect(workspace);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // القفل بيمنع قبول لينك أثناء خطوة بتغيّر الشاشة والدور.
    if (locked) return;
    connect(value);
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
        disabled={locked}
        onChange={(event) => setValue(event.target.value)}
      />
      {alert === 'link' ? <p role="alert">{t(locale, 'personalStaff.linkRequired')}</p> : null}
      {alert === 'camera' ? <p role="alert">{t(locale, 'nativeShell.scanCameraDenied')}</p> : null}
      <Button type="submit" disabled={locked}>
        {t(locale, 'nativeShell.pasteSubmit')}
      </Button>
      {qrScan ? (
        <PasteLinkScan
          locked={locked}
          onScanned={connect}
          onCameraRefused={() => setAlert('camera')}
        />
      ) : null}
      {/* البناء اللي مالوش كاميرا: الموظفة بتتعمل الخطوة من نسخة الويب. */}
      {!qrScan ? <WebOnlyNotice path="/personal" /> : null}
    </form>
  );
}
