'use client';
import type { CustomerPackageDetail, ExtendPackageInput } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useRef, useState, type FormEvent } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import { useCustomerPackageDetail } from '../api/use-customer-package-detail';
import { useExtendPackage } from '../api/use-extend-package';
import type { SessionServiceScope } from '../api/use-session-services';
import {
  extendErrorMessageKey,
  extendPackageBody,
  extendPackageResolver,
  extendPackageStale,
} from '../model/extend-package-values';
import { ExtendPackageForm } from './extend-package-form';

type FailureContext = {
  error: unknown;
  locale: Locale;
  form: UseFormReturn<ExtendPackageInput>;
  refetch: () => Promise<{ data: CustomerPackageDetail | undefined; isError: boolean }>;
  setRoot: (message: string | null) => void;
  setBlocked: (blocked: boolean) => void;
};

function forbidden(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const value = error as { status?: unknown; code?: unknown };
  return value.status === 403 || value.code === 'FORBIDDEN' || value.code === 'FEATURE_DISABLED';
}

async function handleExtensionFailure(context: FailureContext): Promise<void> {
  const { error, locale, form, refetch, setRoot, setBlocked } = context;
  if (extendPackageStale(error)) {
    try {
      const refreshed = await refetch();
      if (refreshed.isError || refreshed.data === undefined) {
        setBlocked(true);
        setRoot(t(locale, 'packageExtension.errorLoad'));
        return;
      }
      const current = refreshed.data.expires_on;
      form.setValue('expected_expires_on', current, { shouldValidate: false });
      setBlocked(false);
      setRoot(t(locale, 'packageExtension.errorStale').replace('{date}', current));
      await form.trigger('new_expires_on');
    } catch {
      setBlocked(true);
      setRoot(t(locale, 'packageExtension.errorLoad'));
    }
    return;
  }
  setRoot(t(locale, extendErrorMessageKey(error)));
  setBlocked(forbidden(error));
}

export type ExtendPackageDialogProps = {
  scope: SessionServiceScope;
  customerId: string;
  entitlementId: string;
  currentExpiresOn: string;
  onClose: () => void;
  onSaved?: () => void;
};

export function ExtendPackageDialog(props: ExtendPackageDialogProps) {
  const locale = useLocale();
  const form = useForm<ExtendPackageInput>({
    resolver: extendPackageResolver(),
    defaultValues: { new_expires_on: '', expected_expires_on: props.currentExpiresOn, reason: '' },
  });
  const expected = useWatch({ control: form.control, name: 'expected_expires_on' });
  const detail = useCustomerPackageDetail(props.scope, props.customerId, props.entitlementId);
  const mutation = useExtendPackage(props.scope, props.customerId, props.entitlementId);
  const [root, setRoot] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);
  const pending = mutation.isPending;
  const submit = async (values: ExtendPackageInput) => {
    setSaved(false);
    setRoot(null);
    try {
      await mutation.mutateAsync(extendPackageBody(values));
    } catch (error) {
      await handleExtensionFailure({ error, locale, form, refetch: detail.refetch, setRoot, setBlocked });
      return;
    }
    setSaved(true);
    setRoot(t(locale, 'packageExtension.success'));
    props.onSaved?.();
    props.onClose();
  };
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    // الديالوج جوه فورم تسجيل الزيارة، فلازم نوقف الـ submit هنا عشان التمديد ما يبعتش الزيارة كمان
    event.preventDefault();
    event.stopPropagation();
    if (submitting.current || pending || blocked) return;
    submitting.current = true;
    void form.handleSubmit(submit)(event).finally(() => {
      submitting.current = false;
    });
  };
  return (
    <ModalDialog title={t(locale, 'packageExtension.dialogTitle')} pending={pending} onClose={props.onClose}>
      <form className="grid gap-4" noValidate onSubmit={onSubmit}>
        {root ? <p role={saved ? 'status' : 'alert'}>{root}</p> : null}
        <ExtendPackageForm form={form} currentExpiresOn={expected} disabled={pending} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" disabled={pending} onClick={props.onClose}>
            {t(locale, 'packageExtension.cancel')}
          </Button>
          <Button type="submit" disabled={pending || blocked}>
            {t(locale, pending ? 'packageExtension.saving' : 'packageExtension.submit')}
          </Button>
        </div>
      </form>
    </ModalDialog>
  );
}
