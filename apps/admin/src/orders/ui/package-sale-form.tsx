'use client';
import {
  sellPackageInput,
  type PackageSaleRecorder,
  type SellablePackageType,
  type SellPackageInput,
} from '@pospay/contracts';
import { moneyToString, parseMoney } from '@pospay/domain';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { Button, Label, NativeSelect } from '@pospay/ui';
import { useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { usePackageSaleContext } from '../api/use-package-sale-context';
import { usePackageSaleStatus } from '../api/use-package-sale-status';
import { useSellPackage } from '../api/use-sell-package';
import type { SessionServiceScope } from '../api/use-session-services';
import { SessionCustomerField, type SessionCustomerSelection } from './session-customer-field';
import { PackageSaleFields, type PackageSaleFieldValues } from './package-sale-fields';
import { PackageSaleResult } from './package-sale-result';
import { PackageSaleTypeField } from './package-sale-type-field';

function saleBody(
  values: PackageSaleFieldValues,
  customer: SessionCustomerSelection,
  type: SellablePackageType,
  recorderMembershipId: string,
): SellPackageInput {
  const normalized = normalizeKwdInput(values.price_paid);
  return sellPackageInput.parse({
    customer_id: customer.id,
    package_type_id: type.id,
    expected_type_revision: type.revision,
    expected_service_revisions: type.components.map((component) => ({
      service_id: component.service_id,
      revision: component.service_revision,
    })),
    price_paid: moneyToString(parseMoney(normalized)),
    paid_method: values.paid_method,
    seller_employee_id: values.seller_employee_id,
    recorder_membership_id: recorderMembershipId,
  });
}

function packageSaleSubmission(
  form: UseFormReturn<PackageSaleFieldValues>,
  locale: 'ar' | 'en',
  mutation: ReturnType<typeof useSellPackage>,
  onSuccess: (saleRequestId: string) => void,
) {
  return (
    values: PackageSaleFieldValues,
    customer: SessionCustomerSelection | null,
    type: SellablePackageType | null,
    recorder: PackageSaleRecorder | undefined,
  ) => {
    form.clearErrors('root');
    if (!customer || !type || !recorder) {
      form.setError('root', { message: t(locale, 'packageSale.invalid') });
      return;
    }
    try {
      mutation.mutate(saleBody(values, customer, type, recorder.membership_id), { onSuccess });
    } catch {
      form.setError('root', { message: t(locale, 'packageSale.invalid') });
    }
  };
}

function usePackageSaleFormState(scope: SessionServiceScope, locale: 'ar' | 'en') {
  const [customer, setCustomer] = useState<SessionCustomerSelection | null>(null);
  const [type, setType] = useState<SellablePackageType | null>(null);
  const [recorderChoice, setRecorderChoice] = useState<string | null>(null);
  const [saleRequestId, setSaleRequestId] = useState<string | null>(null);
  const context = usePackageSaleContext(scope);
  const recorders = context.data?.recorders ?? [];
  const recorder =
    recorders.find((entry) => entry.membership_id === recorderChoice) ??
    (recorders.length === 1 ? recorders[0] : undefined);
  const form = useForm<PackageSaleFieldValues>({
    defaultValues: { price_paid: '', paid_method: 'CASH', seller_employee_id: '' },
  });
  const mutation = useSellPackage(scope);
  const status = usePackageSaleStatus(scope, saleRequestId);
  const pending =
    mutation.isPending ||
    (saleRequestId !== null &&
      status.data?.status !== 'completed' &&
      status.data?.status !== 'failed');
  const submitSale = packageSaleSubmission(form, locale, mutation, setSaleRequestId);
  const entryScope = context.data?.customer_entry_scope;
  const submit = form.handleSubmit((values) =>
    submitSale(values, entryScope ? customer : null, type, recorder),
  );
  const recorderField =
    recorders.length < 2 ? null : (
      <>
        <Label htmlFor="package-sale-recorder">{t(locale, 'packageSale.recorder')}</Label>
        <NativeSelect
          id="package-sale-recorder"
          value={recorder?.membership_id ?? ''}
          disabled={pending}
          onChange={(event) => setRecorderChoice(event.target.value || null)}
        >
          <option value="">{t(locale, 'packageSale.chooseRecorder')}</option>
          {recorders.map((entry) => (
            <option key={entry.membership_id} value={entry.membership_id}>
              {entry.scope_type} · {entry.scope_id}
            </option>
          ))}
        </NativeSelect>
      </>
    );
  return {
    entryScope,
    customer,
    type,
    recorderField,
    saleRequestId,
    form,
    mutation,
    status,
    pending,
    submit,
    setCustomer,
    setType,
  };
}

export function PackageSaleForm({ scope }: { scope: SessionServiceScope }) {
  const locale = useLocale();
  const state = usePackageSaleFormState(scope, locale);
  const {
    entryScope,
    customer,
    type,
    recorderField,
    saleRequestId,
    form,
    mutation,
    status,
    pending,
    submit,
    setCustomer,
    setType,
  } = state;
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-5 text-start">
      {recorderField}
      {entryScope === null && <p role="alert">{t(locale, 'packageSale.customerUnavailable')}</p>}
      <SessionCustomerField
        {...scope}
        entryScope={entryScope ?? 'branch'}
        value={customer}
        onChange={setCustomer}
        disabled={pending || !entryScope}
      />
      <PackageSaleTypeField
        scope={scope}
        value={type}
        disabled={pending}
        onChange={(selected) => {
          setType(selected);
          form.setValue('price_paid', selected.price, { shouldDirty: true });
        }}
        onReconfirm={setType}
      />
      <PackageSaleFields scope={scope} form={form} disabled={pending} />
      {form.formState.errors.root ? <p role="alert">{form.formState.errors.root.message}</p> : null}
      {mutation.isError ? <p role="alert">{envelopeMessage(mutation.error, locale)}</p> : null}
      <Button
        type="submit"
        disabled={pending || !entryScope || status.data?.status === 'completed'}
      >
        {t(locale, pending ? 'packageSale.submitting' : 'packageSale.submit')}
      </Button>
      {saleRequestId ? (
        <PackageSaleResult
          status={status.data}
          timedOut={status.timedOut}
          recheck={status.recheck}
          error={status.error}
        />
      ) : null}
    </form>
  );
}
