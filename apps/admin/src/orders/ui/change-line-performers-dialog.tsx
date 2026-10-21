'use client';
import type { ChangeLinePerformersInput, ServiceSessionDayPage } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { FormProvider, useForm, type UseFormReturn } from 'react-hook-form';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useLocale } from '@/shared/locale/locale-context';
import {
  useChangeLinePerformers,
  type UnresolvedPerformersChange,
} from '../api/use-change-line-performers';
import type { SessionServiceScope } from '../api/use-session-services';
import {
  performersBody,
  performersSeed,
  type PerformersFormInput,
} from '../model/change-line-performers-values';
import { sessionBpsText } from '../model/session-recording-result';
import type { SessionDraftLine } from '../model/session-drafts';
import { ChangeLinePerformersFields } from './change-line-performers-fields';
import {
  submitPerformersChange,
  type PerformersSubmitInput,
  type PerformersSubmitProps,
} from './change-line-performers-submit';
import { SessionPerformersField } from './session-performers-field';

type DayLine = ServiceSessionDayPage['items'][number]['lines'][number];
type AttemptMemory = RefObject<Map<string, UnresolvedPerformersChange>>;

// الطلب اللي نتيجته مجهولة بيرجع بنفس المنفّذين والنسب اللي اتبعتت، عشان اللي ظاهر هو اللي هيتعاد.
function keptDraft(line: DayLine, body: ChangeLinePerformersInput): SessionDraftLine {
  const custom = body.performers.every((row) => row.share_bps !== undefined);
  return {
    ...performersSeed(line),
    share_mode: custom ? 'CUSTOM' : 'EQUAL',
    performers: body.performers.map((row) => ({
      employee_id: row.employee_id,
      share_percentage: custom && row.share_bps !== undefined ? sessionBpsText(row.share_bps) : '',
      selection: null,
    })),
  };
}

function resumedChange(
  line: DayLine,
  sessionId: string,
  memory: Map<string, UnresolvedPerformersChange> | undefined,
  locale: Locale,
) {
  const pending = memory?.get(line.id);
  const kept = pending?.sessionId === sessionId ? pending : undefined;
  const values: PerformersFormInput = {
    lines: [kept ? keptDraft(line, kept.body) : performersSeed(line)],
    reason: kept?.body.reason ?? '',
    expected_revision: kept?.body.expected_revision ?? line.revision,
    changer_membership_id: kept?.body.changer_membership_id ?? '',
  };
  return {
    body: kept?.body ?? null,
    frozen: kept !== undefined,
    root: kept ? t(locale, 'serviceLinePerformers.outcomeUnknown') : null,
    values,
  };
}

function CurrentPerformers({ line, locale }: { line: DayLine; locale: Locale }) {
  return (
    <div className="grid gap-1 text-start">
      <p>{t(locale, 'serviceLinePerformers.current')}</p>
      <ul className="grid gap-1">
        {line.performers.map((row) => (
          <li key={row.employee_id}>
            {locale === 'ar' ? (row.name_ar ?? row.name_en) : row.name_en}{' '}
            <bdi>
              {t(locale, 'serviceSessions.percentValue').replace(
                '{value}',
                sessionBpsText(row.share_bps),
              )}
            </bdi>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PerformersForm({
  form,
  attempt,
  children,
}: {
  form: UseFormReturn<PerformersFormInput>;
  attempt: Omit<PerformersSubmitInput, 'body'>;
  children: ReactNode;
}) {
  const send = (body: ChangeLinePerformersInput) => {
    attempt.setRoot(null);
    void submitPerformersChange({ ...attempt, body });
  };
  return (
    <form
      className="grid gap-3"
      noValidate
      onSubmit={(event) => {
        const kept = attempt.retain.current;
        if (kept) {
          event.preventDefault();
          send(kept);
          return;
        }
        void form.handleSubmit((values) => {
          const body = performersBody(values);
          if (body) send(body);
          else attempt.setRoot(t(attempt.locale, 'serviceSessions.invalidShare'));
        })(event);
      }}
    >
      {children}
    </form>
  );
}

// الطلب ممكن يخلص بعد قفل الحوار؛ المرجع بيمنع تحديث فورم اتفك تركيبه.
function useMountedRef() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

export type ChangeLinePerformersDialogProps = PerformersSubmitProps & {
  scope: SessionServiceScope;
  line: DayLine;
  occurredAt: string;
  online: boolean;
  attempts?: AttemptMemory;
};

export function ChangeLinePerformersDialog(props: ChangeLinePerformersDialogProps) {
  const locale = useLocale();
  const [resumed] = useState(() =>
    resumedChange(props.line, props.sessionId, props.attempts?.current, locale),
  );
  const form = useForm<PerformersFormInput>({ defaultValues: resumed.values });
  const mutation = useChangeLinePerformers(props.scope, props.attempts, props.onAccessDenied);
  const [root, setRoot] = useState<string | null>(resumed.root);
  const [memberships, setMemberships] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(resumed.frozen);
  const retain = useRef<ChangeLinePerformersInput | null>(resumed.body);
  const mounted = useMountedRef();
  const pending = mutation.isPending;
  const attempt = {
    props,
    locale,
    form,
    mutate: mutation.mutateAsync,
    setRoot,
    setMemberships,
    setFrozen,
    retain,
    mounted,
  };
  return (
    <ModalDialog
      title={t(locale, 'serviceLinePerformers.title')}
      pending={pending}
      onClose={props.onClose}
    >
      <CurrentPerformers line={props.line} locale={locale} />
      <FormProvider {...form}>
        <PerformersForm form={form} attempt={attempt}>
          {root ? <p role="alert">{root}</p> : null}
          <SessionPerformersField
            scope={props.scope}
            index={0}
            occurredAt={props.occurredAt}
            disabled={frozen || pending}
          />
          <ChangeLinePerformersFields
            form={form}
            locale={locale}
            companyId={props.scope.companyId}
            userId={props.scope.userId}
            memberships={memberships}
            online={props.online}
            pending={pending}
            frozen={frozen}
            onClose={props.onClose}
          />
        </PerformersForm>
      </FormProvider>
    </ModalDialog>
  );
}
