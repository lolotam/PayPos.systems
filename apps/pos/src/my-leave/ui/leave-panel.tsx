import { leaveErrorText } from '../model/error-text';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { LeaveContext } from '../model/context';
import { useMyLeave } from '../api/use-my-leave';
import { LeaveForm } from './leave-form';
import { LeaveHistory } from './leave-history';
import { leaveReadRefused } from '../model/read-error';
import { LatestLeaveRequest } from './latest-leave-request';

export function LeavePanel({
  context,
  branch,
  timezone,
}: {
  context: LeaveContext;
  branch: string;
  timezone?: string | undefined;
}) {
  const locale = useLocale();
  const state = useMyLeave(context, branch);
  const error = state.error ?? state.query.error;
  const items = state.query.data?.pages.flatMap((page) => page.items) ?? [];
  const canCreate = state.query.data?.pages[0]?.request_branch_ids.includes(branch) ?? false;
  return (
    <div className="grid gap-4">
      {state.busy ? <p role="status">{t(locale, 'pos.loading')}</p> : null}
      {error ? <p role="alert">{leaveErrorText(error, locale)}</p> : null}
      {state.success ? <p role="status">{t(locale, `leave.${state.success}`)}</p> : null}
      {state.query.isPending ? (
        <p role="status">{t(locale, 'pos.loading')}</p>
      ) : state.query.isError &&
        (state.query.data === undefined || leaveReadRefused(state.query.error)) ? (
        <Button
          onClick={() => {
            void state.query.refetch();
          }}
        >
          {t(locale, 'myLeave.retry')}
        </Button>
      ) : (
        <>
          {state.lastRequest ? <LatestLeaveRequest request={state.lastRequest} /> : null}
          <p>
            {t(locale, 'leave.timezone')}
            {timezone ? `: ${timezone}` : ''}
          </p>
          {canCreate && (context.mode === 'personal' || timezone !== undefined) ? (
            <LeaveForm busy={state.busy} submit={state.create} />
          ) : null}
          {items.length === 0 ? (
            <p>{t(locale, 'leave.empty')}</p>
          ) : (
            <LeaveHistory items={items} busy={state.busy} cancel={state.cancel} />
          )}
          {state.query.hasNextPage ? (
            <Button
              disabled={state.query.isFetchingNextPage}
              onClick={() => {
                void state.query.fetchNextPage();
              }}
            >
              {t(locale, 'leave.next')}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
