import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useAttendanceCamera } from '../api/use-attendance-camera';

export function AttendanceCamera({
  scanned,
  failed,
  stop,
}: {
  scanned(value: string): Promise<void>;
  failed(): void;
  stop(): void;
}) {
  const locale = useLocale();
  const video = useAttendanceCamera(scanned, failed);
  return (
    <div className="grid gap-4">
      <p>{t(locale, 'personalAttendance.cameraLead')}</p>
      <video
        ref={video}
        muted
        playsInline
        aria-label={t(locale, 'personalAttendance.cameraLabel')}
        className="w-full rounded-lg"
      />
      <Button size="touch" variant="outline" onClick={stop}>
        {t(locale, 'personalAttendance.cancel')}
      </Button>
    </div>
  );
}
