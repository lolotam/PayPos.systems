import { useState } from 'react';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { MyWorkScreen } from '@/my-work/ui/my-work-screen';
import type { WorkContext } from '@/my-work/model/work-context';
import { useLocale } from '@/shared/locale/locale-context';

/**
 * زر «شغلي»؛ الشاشة بتتفتح بس لما الموظفة تدوس عليه وبتتقفل (وتتمسح بياناتها) لما تدوس تاني.
 * الهوية (`context.identity`) هي مفتاح الشاشة، فتغيّرها بيفك الشاشة ويمسح بياناتها.
 *
 * @param props.context مين بيفتح الشاشة وهويته
 */
export function OwnWorkToggle({ context }: { context: WorkContext }) {
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
