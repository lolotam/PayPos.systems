'use client';
import type { CancelServiceLineInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useLocale } from '@/shared/locale/locale-context';
import { useCancelServiceLine } from '../api/use-cancel-service-line';
import type { SessionServiceScope } from '../api/use-session-services';
import { resolveCancelLine, type CancelLineFormInput } from '../model/cancel-service-line-values';
import { CancelServiceLineForm } from './cancel-service-line-form';

export type CancelServiceLineDialogProps = {
  scope: SessionServiceScope;
  sessionId: string;
  line: { id: string; revision: number };
  online: boolean;
  onSaved: () => void;
  onForbidden: (message: string) => void;
  onAccessDenied?: (message: string) => void;
  onClose: () => void;
};
export function CancelServiceLineDialog(props: CancelServiceLineDialogProps) {
  const locale = useLocale();
  const form = useForm<CancelLineFormInput, unknown, CancelServiceLineInput>({
    resolver: resolveCancelLine,
    defaultValues: {
      reason: '',
      expected_revision: props.line.revision,
      canceller_membership_id: '',
    },
  });
  const mutation = useCancelServiceLine(props.scope);
  const [root, setRoot] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(false);
  const retain = useRef<CancelServiceLineInput | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pending = mutation.isPending;
  return (
    <ModalDialog
      title={t(locale, 'serviceLineCancel.title')}
      pending={pending}
      onClose={props.onClose}
    >
      <CancelServiceLineForm
        form={form}
        locale={locale}
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
