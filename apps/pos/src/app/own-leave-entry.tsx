import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { recoverLeaveSession } from './recover-leave-session';
import { Button } from '@pospay/ui';
import { t } from '@pospay/i18n';
import { MyLeaveScreen } from '@/my-leave/ui/my-leave-screen';
import { leaveIdentity, type LeaveContext } from '@/my-leave/model/context';
import { useLocale } from '@/shared/locale/locale-context';

export function OwnLeaveEntry({ context }: { context: LeaveContext }) {
  const cache = useQueryClient();
  const [opened, setOpened] = useState(false);
  const locale = useLocale();
  return (
    <div className="grid gap-3">
      <Button variant="outline" aria-expanded={opened} onClick={() => setOpened(!opened)}>
        {t(locale, opened ? 'leave.close' : 'myLeave.title')}
      </Button>
      {opened ? (
        <MyLeaveScreen
          key={leaveIdentity(context)}
          context={context}
          recoverSession={(current, branch, signal) =>
            recoverLeaveSession(current, branch, signal, cache)
          }
        />
      ) : null}
    </div>
  );
}
