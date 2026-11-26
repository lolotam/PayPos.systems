import { useState } from 'react';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { AttendanceScreen } from '@/my-attendance/ui/attendance-screen';
import type { AttendanceContext } from '@/my-attendance/model/attendance-context';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * زر «حضوري»؛ الشاشة بتتفتح بس لما الموظفة تدوس عليه وبتتقفل (وبتتمسح بياناتها) لما تدوس تاني.
 * الهوية (`context.identity`) هي مفتاح الشاشة، فتغيّرها بيفك الشاشة ويمسح بياناتها.
 *
 * @param props.context مين بيفتح الشاشة وهويتها
 * @param props.timeZone توقيت النشاط؛ على جهاز الاستقبال ده توقيت فرع الجهاز
 */
export function OwnAttendanceToggle({
  context,
  timeZone,
}: {
  context: AttendanceContext;
  timeZone: string | undefined;
}) {
  const locale = useLocale();
  const [opened, setOpened] = useState(false);
  return (
    <div className="grid gap-3">
      <Button variant="outline" aria-expanded={opened} onClick={() => setOpened(!opened)}>
        {t(locale, opened ? 'myAttendance.close' : 'myAttendance.title')}
      </Button>
      {opened ? (
        <AttendanceScreen
          key={context.identity}
          context={context}
          timeZone={timeZone}
          onLeave={() => setOpened(false)}
        />
      ) : null}
    </div>
  );
}
