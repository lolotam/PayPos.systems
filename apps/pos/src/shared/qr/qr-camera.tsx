import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';

import { useLocale } from '@/shared/locale/locale-context';

import { useQrCamera } from './use-qr-camera';

/**
 * كاميرا QR مشتركة: بتعرض الفيديو وبتسلّم الكود المقروء أو الفشل.
 *
 * الشاشة اللي بتستخدمها بتبعتّلها نصوصها (عنوان الكاميرا ووصفها)، لأن الشاشة دي
 * بتتشغّل في أكتر من مكان: حضور الصالون (FR-012) وكود الصالون في شاشة الاتصال (FR-014).
 *
 * @param props.scanned بيتنادى بالقيمة المقروءة
 * @param props.failed بيتنادى لما الكاميرا تفشل
 * @param props.stop بيقفل الكاميرا
 * @param props.lead السطر اللي بيقول للمستخدم يوجّه الكاميرا فين
 * @param props.label وصف الكاميرا لقارئ الشاشة
 */
export function QrCamera({
  scanned,
  failed,
  stop,
  lead,
  label,
}: {
  scanned(value: string): Promise<void>;
  failed(): void;
  stop(): void;
  lead: string;
  label: string;
}) {
  const locale = useLocale();
  const video = useQrCamera(scanned, failed);
  return (
    <div className="grid gap-4">
      <p>{lead}</p>
      <video ref={video} muted playsInline aria-label={label} className="w-full rounded-lg" />
      <Button size="touch" variant="outline" onClick={stop}>
        {t(locale, 'personalAttendance.cancel')}
      </Button>
    </div>
  );
}
