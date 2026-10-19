'use client';
import type { CancelServiceLineInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useForm } from 'react-hook-form';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useLocale } from '@/shared/locale/locale-context';
import { useCancelServiceLine, type UnresolvedCancel } from '../api/use-cancel-service-line';
import type { SessionServiceScope } from '../api/use-session-services';
import { resolveCancelLine, type CancelLineFormInput } from '../model/cancel-service-line-values';
import { CancelServiceLineForm } from './cancel-service-line-form';
import { CancelServiceLinePreview, type CancelDialogLine } from './cancel-service-line-preview';

type AttemptMemory = RefObject<Map<string, UnresolvedCancel>>;

function resumedCancel(
  line: CancelDialogLine,
  sessionId: string,
  memory: Map<string, UnresolvedCancel> | undefined,
  locale: Locale,
) {
  const pending = memory?.get(line.id);
  const kept = pending?.sessionId === sessionId ? pending : undefined;
  return {
    body: kept?.body ?? null,
    frozen: kept !== undefined,
    root: kept ? t(locale, 'serviceLineCancel.outcomeUnknown') : null,
    values: {
      reason: kept?.body.reason ?? '',
      expected_revision: kept?.body.expected_revision ?? line.revision,
      canceller_membership_id: kept?.body.canceller_membership_id ?? '',
    },
  };
}

export type CancelServiceLineDialogProps = {
  scope: SessionServiceScope;
  sessionId: string;
  line: CancelDialogLine;
  online: boolean;
  onSaved: () => void;
  onForbidden: (message: string) => void;
  onAccessDenied?: (message: string) => void;
  onClose: () => void;
  onRefresh?: () => Promise<{ status: string; revision: number } | null>;
  attempts?: AttemptMemory;
};
export function CancelServiceLineDialog(props: CancelServiceLineDialogProps) {
  const locale = useLocale();
  const resumed = resumedCancel(props.line, props.sessionId, props.attempts?.current, locale);
  const form = useForm<CancelLineFormInput, unknown, CancelServiceLineInput>({
    resolver: resolveCancelLine,
    defaultValues: resumed.values,
  });
  const mutation = useCancelServiceLine(props.scope, props.attempts, props.onAccessDenied);
  const [root, setRoot] = useState<string | null>(resumed.root);
  const [memberships, setMemberships] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(resumed.frozen);
  const retain = useRef<CancelServiceLineInput | null>(resumed.body);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    form.setValue('expected_revision', props.line.revision);
  }, [form, props.line.revision]);
  const pending = mutation.isPending;
  return (
    <ModalDialog
      title={t(locale, 'serviceLineCancel.title')}
      pending={pending}
      onClose={props.onClose}
    >
      <CancelServiceLinePreview line={props.line} locale={locale} />
      <CancelServiceLineForm
        form={form}
        locale={locale}
        companyId={props.scope.companyId}
        userId={props.scope.userId}
        root={root}
        memberships={memberships}
        online={props.online}
        pending={pending}
        frozen={frozen}
        retain={retain}
        onClose={props.onClose}
        attempt={{
          props,
          locale,
          form,
          mutate: mutation.mutateAsync,
          setRoot,
          setMemberships,
          setFrozen,
          retain,
          mounted,
        }}
      />
    </ModalDialog>
  );
}
