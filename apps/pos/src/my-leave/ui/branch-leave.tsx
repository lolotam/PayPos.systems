import { useState } from 'react';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { useLeaveBranches } from '../api/use-my-leave';
import { leaveErrorText } from '../model/error-text';
import type { LeaveContext } from '../model/context';
import { LeavePanel } from './leave-panel';
import { leaveReadRefused } from '../model/read-error';

export function BranchLeave({ context }: { context: LeaveContext }) {
  const locale = useLocale();
  const [sessionRefusal, setSessionRefusal] = useState<unknown>(null);
  const branches = useLeaveBranches(context, !sessionRefusal, setSessionRefusal);
  const [selected, setSelected] = useState('');
  if (sessionRefusal) return <p role="alert">{leaveErrorText(sessionRefusal, locale)}</p>;
  if (context.mode === 'reception')
    return (
      <LeavePanel
        context={context}
        branch={context.branch_id ?? ''}
        timezone={context.timezone}
        sessionRefused={setSessionRefusal}
      />
    );
  if (branches.isPending) return <p role="status">{t(locale, 'pos.loading')}</p>;
  if (branches.isError && (branches.data === undefined || leaveReadRefused(branches.error)))
    return (
      <div>
        <p role="alert">{leaveErrorText(branches.error, locale)}</p>
        <Button
          onClick={() => {
            void branches.refetch();
          }}
        >
          {t(locale, 'myLeave.retry')}
        </Button>
      </div>
    );
  if (branches.data === undefined) return null;
  const items = branches.data.items;
  if (items.length === 0) return <p>{t(locale, 'myLeave.noBranches')}</p>;
  const branch = items.some((item) => item.id === selected) ? selected : '';
  return (
    <>
      {branches.isError ? <p role="alert">{leaveErrorText(branches.error, locale)}</p> : null}
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
          sessionRefused={setSessionRefusal}
        />
      ) : null}
    </>
  );
}
