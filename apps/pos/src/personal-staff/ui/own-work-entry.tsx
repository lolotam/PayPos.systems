import { useState } from 'react';
import type { PersonalSessionContext, StaffSessionContext } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { MyWorkScreen } from '@/my-work/ui/my-work-screen';
import type { WorkContext } from '@/my-work/model/work-context';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * زر «شغلي»؛ الشاشة بتتفتح بس لما الموظفة تدوس عليه وبتتقفل (وتتمسح بياناتها) لما تدوس تاني.
 *
 * @param props.context مين بيفتح الشاشة وهويته
 */
function OwnWorkEntry({ context }: { context: WorkContext }) {
  const locale = useLocale();
  const [opened, setOpened] = useState(false);
  return (
    <div className="grid gap-3">
      <Button variant="outline" aria-expanded={opened} onClick={() => setOpened(!opened)}>
        {t(locale, opened ? 'myWork.close' : 'myWork.title')}
      </Button>
      {opened ? (
        <MyWorkScreen key={context.identity} context={context} onLeave={() => setOpened(false)} />
      ) : null}
    </div>
  );
}

/**
 * «شغلي» على موبايلها الشخصي: من غير PIN. تبديل الجلسة أو الدورة بيرجّعه مقفول.
 *
 * @param props.session الجلسة الشخصية الحية
 * @param props.epoch دورة الجلسة اللي بتتغير مع الخروج أو التبديل
 */
export function PersonalWorkEntry({
  session,
  epoch,
}: {
  session: PersonalSessionContext;
  epoch: number;
}) {
  const identity = `${epoch}:${session.user_id}:${session.employee_id}:${session.expires_at}`;
  return <OwnWorkEntry key={identity} context={{ mode: 'personal', identity }} />;
}

/**
 * «شغلي» على جهاز الاستقبال: الشاشة بتطلب الـ PIN الأول. تبديل المشغّلة بيغيّر الهوية فبيتقفل
 * وبيرجع لخطوة الـ PIN.
 *
 * @param props.session جلسة المشغّلة على الجهاز
 * @param props.epoch دورة جلسة المشغّلة
 * @param props.timezone توقيت الفرع لو الجهاز عارفه
 */
export function ReceptionWorkEntry({
  session,
  epoch,
  timezone,
}: {
  session: StaffSessionContext;
  epoch: number;
  timezone?: string | undefined;
}) {
  const identity = `${epoch}:${session.user_id}:${session.device_id}:${session.expires_at}`;
  return (
    <OwnWorkEntry
      key={identity}
      context={{ mode: 'reception', identity, ...(timezone ? { timezone } : {}) }}
    />
  );
}
