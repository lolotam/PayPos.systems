import { useEffect, useState } from 'react';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';

import { leaveIdentity, type LeaveContext } from '../model/context';
import { BranchLeave } from './branch-leave';

export function MyLeaveScreen({ context }: { context: LeaveContext }) {
  const [online, setOnline] = useState(navigator.onLine);
  const locale = useLocale();
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <section
      aria-label={t(locale, 'myLeave.title')}
      dir={locale === 'ar' ? 'rtl' : 'ltr'}
      className="grid gap-4"
    >
      <h2>{t(locale, 'myLeave.title')}</h2>
      {online ? (
        <BranchLeave key={leaveIdentity(context)} context={context} />
      ) : (
        <p role="status">{t(locale, 'myLeave.offline')}</p>
      )}
    </section>
  );
}
