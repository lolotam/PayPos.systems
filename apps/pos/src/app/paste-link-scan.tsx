import { useState } from 'react';

import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';
import { QrCamera } from '@/shared/qr/qr-camera';

/**
 * زرار مسح كود الصالون بالكاميرا في شاشة الاتصال (FR-014).
 *
 * الشاشة دي بتفتح الكاميرا وبتسلّم الكود المقروء للينك العادي، فأي كود تاني بيرجع
 * للمستخدم عادي (الرابط مطلوب من المدير) من غير ما الشاشة تقفل.
 *
 * @param props.onScanned بيتنادى بالكود المقروء
 * @param props.onCameraRefused بيتنادى لما الكاميرا تفشل أو الإذن يُرفض
 * @param props.locked بيقفل الزرار أثناء خطوة بتغيّر الشاشة
 */
export function PasteLinkScan({
  onScanned,
  onCameraRefused,
  locked = false,
}: {
  onScanned(raw: string): void;
  onCameraRefused(): void;
  locked?: boolean;
}) {
  const locale = useLocale();
  const [scanning, setScanning] = useState(false);
  if (!scanning) {
    return (
      <Button
        type="button"
        size="touch"
        variant="outline"
        disabled={locked}
        onClick={() => setScanning(true)}
      >
        {t(locale, 'nativeShell.scanSalonQr')}
      </Button>
    );
  }
  return (
    <QrCamera
      scanned={async (raw) => {
        setScanning(false);
        onScanned(raw);
      }}
      failed={() => {
        setScanning(false);
        onCameraRefused();
      }}
      stop={() => setScanning(false)}
      lead={t(locale, 'nativeShell.scanSalonLead')}
      label={t(locale, 'nativeShell.scanSalonCameraLabel')}
    />
  );
}
