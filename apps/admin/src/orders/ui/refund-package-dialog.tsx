'use client';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useRefundPackage, type HeldAttempt } from '../api/use-refund-package';
import type { SessionServiceScope } from '../api/use-session-services';
import {
  refundErrorMessageKey,
  refundPackageBody,
  refundPackageResolver,
  type RefundPackageComponent,
  type RefundPackageFormValues,
} from '../model/refund-package-values';
import { RefundPackageForm } from './refund-package-fields';

function forbidden(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { status?: unknown; code?: unknown };
  return value.status === 403 || value.code === 'FORBIDDEN' || value.code === 'FEATURE_DISABLED';
}

export type RefundPackageDialogProps = {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  components: readonly RefundPackageComponent[];
  heldAttemptRef?: { current: HeldAttempt | null } | undefined;
  onClose: () => void;
  onSaved?: () => void;
};

function RefundDialogActions({
  locale,
  pending,
  blocked,
  onClose,
}: {
  locale: ReturnType<typeof useLocale>;
  pending: boolean;
  blocked: boolean;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button type="button" variant="outline" disabled={pending} onClick={onClose}>
        {t(locale, 'packageRefund.cancel')}
      </Button>
      <Button type="submit" disabled={pending || blocked}>
        {t(locale, pending ? 'packageRefund.submitting' : 'packageRefund.submit')}
      </Button>
    </div>
  );
}

function useRefundDialogForm(props: RefundPackageDialogProps) {
  const locale = useLocale();
  const form = useForm<RefundPackageFormValues>({
    resolver: refundPackageResolver(props.components),
    defaultValues: { component_id: '', sessions: 1, method: 'CASH', reason: '' },
  });
  const mutation = useRefundPackage(
    props.scope,
    props.customerId,
    props.entitlementId,
    props.heldAttemptRef,
  );
  const [root, setRoot] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const pending = mutation.isPending;
  const submit = async (values: RefundPackageFormValues) => {
    setSaved(false);
    setRoot(null);
    try {
      await mutation.mutateAsync(refundPackageBody(values));
    } catch (error) {
      setRoot(t(locale, refundErrorMessageKey(error)));
      setBlocked(forbidden(error));
      return;
    }
    setSaved(true);
    setRoot(t(locale, 'packageRefund.success'));
    props.onSaved?.();
    props.onClose();
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // الديالوج جوه فورم تسجيل الزيارة، فلازم نوقف الـ submit هنا عشان الاسترداد ما يبعتش الزيارة كمان
    event.preventDefault();
    event.stopPropagation();
    if (submitting.current || pending || blocked) return;
    submitting.current = true;
    void form
      .handleSubmit(submit)(event)
      .finally(() => {
        submitting.current = false;
      });
  };
  return { locale, form, root, blocked, saved, pending, onSubmit };
}

export function RefundPackageDialog(props: RefundPackageDialogProps) {
  const { locale, form, root, blocked, saved, pending, onSubmit } = useRefundDialogForm(props);
  return (
    <ModalDialog
      title={t(locale, 'packageRefund.dialogTitle')}
      pending={pending}
      onClose={props.onClose}
    >
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        {root ? <p role={saved ? 'status' : 'alert'}>{root}</p> : null}
        <RefundPackageForm form={form} components={props.components} disabled={pending} />
        <RefundDialogActions
          locale={locale}
          pending={pending}
          blocked={blocked}
          onClose={props.onClose}
        />
      </form>
    </ModalDialog>
  );
}
