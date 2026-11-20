import { leaveErrorText } from '../model/error-text';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import type { LeaveContext } from '../model/context';
import type { LeavePage, OwnLeaveWriteResult, RequestLeaveInput } from '@pospay/contracts';
import { useMyLeave } from '../api/use-my-leave';
import { LeaveForm } from './leave-form';
import { LeaveHistory } from './leave-history';
import { leaveReadRefused } from '../model/read-error';
import { LatestLeaveRequest } from './latest-leave-request';

interface LeavePanelProps {
  context: LeaveContext;
  branch: string;
  timezone?: string | undefined;
  sessionRefused?: ((error: unknown) => void) | undefined;
}

export function LeavePanel({ context, branch, timezone, sessionRefused }: LeavePanelProps) {
  const locale = useLocale();
  const state = useMyLeave(context, branch, sessionRefused);
  const refused =
    state.refusal ??
    (leaveReadRefused(state.query.error) ? state.query.error : null) ??
    (leaveReadRefused(state.error) ? state.error : null);
  const error = refused ?? state.error ?? state.query.error;
  const items = state.query.data?.pages.flatMap((page) => page.items) ?? [];
  const canCreate = state.query.data?.pages[0]?.request_branch_ids.includes(branch) ?? false;
  return (
    <div className="grid gap-4">
      {state.busy ? <p role="status">{t(locale, 'pos.loading')}</p> : null}
      {error ? <p role="alert">{leaveErrorText(error, locale)}</p> : null}
      {state.success ? <p role="status">{t(locale, `leave.${state.success}`)}</p> : null}
      {state.query.isPending && !refused ? (
        <p role="status">{t(locale, 'pos.loading')}</p>
      ) : refused || (state.query.isError && state.query.data === undefined) ? (
        <Button
          onClick={() => {
            void state.retry();
          }}
        >
          {t(locale, 'myLeave.retry')}
        </Button>
      ) : (
        <LeaveReadyState
          locale={locale}
          timezone={timezone}
          context={context}
          canCreate={canCreate}
          items={items}
          lastRequest={state.lastRequest}
          busy={state.busy}
          cancel={state.cancel}
          create={state.create}
          hasNextPage={state.query.hasNextPage}
          isFetchingNextPage={state.query.isFetchingNextPage}
          fetchNextPage={state.query.fetchNextPage}
        />
      )}
    </div>
  );
}

function LeaveReadyState({
  locale,
  timezone,
  context,
  canCreate,
  items,
  lastRequest,
  busy,
  cancel,
  create,
  hasNextPage,
  isFetchingNextPage,
  fetchNextPage,
}: {
  locale: Locale;
  timezone: string | undefined;
  context: LeaveContext;
  canCreate: boolean;
  items: LeavePage['items'];
  lastRequest: OwnLeaveWriteResult | null;
  busy: boolean;
  cancel(id: string, revision: number): Promise<void>;
  create(input: RequestLeaveInput): Promise<void>;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  fetchNextPage(): Promise<unknown>;
}) {
  return (
    <>
      {lastRequest ? (
        <LatestLeaveRequest request={lastRequest} busy={busy} cancel={cancel} />
      ) : null}
      <p>
        {t(locale, 'leave.timezone')}
        {timezone ? `: ${timezone}` : ''}
      </p>
      {canCreate && (context.mode === 'personal' || timezone !== undefined) ? (
        <LeaveForm busy={busy} submit={create} />
      ) : null}
      {items.length === 0 ? (
        <p>{t(locale, 'leave.empty')}</p>
      ) : (
        <LeaveHistory items={items} busy={busy} cancel={cancel} />
      )}
      {hasNextPage ? (
        <Button
          disabled={isFetchingNextPage}
          onClick={() => {
            void fetchNextPage();
          }}
        >
          {t(locale, 'leave.next')}
        </Button>
      ) : null}
    </>
  );
}
