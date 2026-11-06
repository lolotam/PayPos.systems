import { leaveErrorText } from '../model/error-text';
import { useEffect, useState } from 'react';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { useLeaveBranches } from '../api/use-my-leave';
import { leaveIdentity, type LeaveContext } from '../model/context';
import { LeavePanel } from './leave-panel';

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

function BranchLeave({ context }: { context: LeaveContext }) {
  const locale = useLocale();
  const branches = useLeaveBranches(context);
  const [selected, setSelected] = useState('');
  if (context.mode === 'reception')
    return <LeavePanel context={context} branch={context.branch_id ?? ''} />;
  if (branches.isPending) return <p role="status">{t(locale, 'pos.loading')}</p>;
  if (branches.isError) return <p role="alert">{leaveErrorText(branches.error, locale)}</p>;
  const items = branches.data.items;
  if (items.length === 0) return <p>{t(locale, 'myLeave.noBranches')}</p>;
  const branch = items.some((item) => item.id === selected) ? selected : '';
  return (
    <>
      <label>
        {t(locale, 'leave.branch')}
        <select value={branch} onChange={(event) => setSelected(event.target.value)}>
          <option value="">{t(locale, 'myLeave.chooseBranch')}</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {locale === 'ar' ? (item.name_ar ?? item.name_en) : item.name_en}
            </option>
          ))}
        </select>
      </label>
      {branch ? (
        <LeavePanel
          key={branch}
          context={context}
          branch={branch}
          timezone={items.find((item) => item.id === branch)?.timezone}
        />
      ) : null}
    </>
  );
}
