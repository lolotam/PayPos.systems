'use client';
import {
  sellPackageInput,
  type PackageSaleStatus,
  type PackageSaleRecorder,
  type SellablePackageType,
  type SellPackageInput,
} from '@pospay/contracts';
import { moneyToString, parseMoney } from '@pospay/domain';
import { normalizeKwdInput, t } from '@pospay/i18n';
import { Button, Card, CardContent, CardFooter, Label, NativeSelect } from '@pospay/ui';
import { useCallback, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { usePackageSaleContext } from '../api/use-package-sale-context';
import { usePackageSaleStatus } from '../api/use-package-sale-status';
import { useSellPackage } from '../api/use-sell-package';
import type { SessionServiceScope } from '../api/use-session-services';
import { serviceSessionAccessRevoked } from '../model/service-session-access';
import { SessionCustomerField, type SessionCustomerSelection } from './session-customer-field';
import { PackageSaleFields, type PackageSaleFieldValues } from './package-sale-fields';
import { PackageSaleRecoveryNotice } from './package-sale-recovery-notice';
import { PackageSaleResult } from './package-sale-result';
import { PackageSaleTypeField } from './package-sale-type-field';
import { usePackageSaleTypeOptions } from './package-sale-type-option';
import { usePackageSaleSubmit } from './use-package-sale-submit';

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

function usePackageSaleRecorderField(
  recorders: PackageSaleRecorder[],
  locale: 'ar' | 'en',
  locked: boolean,
) {
  const [choice, setChoice] = useState<string | null>(null);
  const selected = recorders.find((entry) => entry.membership_id === choice);
  const recorder =
    selected ?? (choice === null && recorders.length === 1 ? recorders[0] : undefined);
  const invalid = choice !== null && !selected;
  const recorderField =
    recorders.length < 2 && !invalid ? null : (
      <>
        <Label htmlFor="package-sale-recorder">{t(locale, 'packageSale.recorder')}</Label>
        <NativeSelect
          id="package-sale-recorder"
          value={recorder?.membership_id ?? ''}
          disabled={locked}
          onChange={(event) => setChoice(event.target.value || null)}
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
  return { recorder, recorderField };
}

function packageSaleSubmission(
  form: UseFormReturn<PackageSaleFieldValues>,
  locale: 'ar' | 'en',
  mutation: ReturnType<typeof useSellPackage>,
  onSuccess: (saleRequestId: string) => void,
) {
  return async (
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
      await mutation
        .mutateAsync(saleBody(values, customer, type, recorder.membership_id))
        .then(onSuccess, () => undefined);
    } catch {
      form.setError('root', { message: t(locale, 'packageSale.invalid') });
    }
  };
}

const saleDefaults: PackageSaleFieldValues = {
  price_paid: '',
  paid_method: 'CASH',
  seller_employee_id: '',
};

function usePackageSaleFormState(scope: SessionServiceScope, locale: 'ar' | 'en') {
  const [selection, setSelection] = useState<{
    customer: SessionCustomerSelection;
    scopeKey: string;
  } | null>(null);
  const [type, setType] = useState<SellablePackageType | null>(null);
  const [saleRequestId, setSaleRequestId] = useState<string | null>(null);
  const { data: context, error: contextError, isPending: contextPending, refetch: refreshContext } = usePackageSaleContext(scope);
  const form = useForm<PackageSaleFieldValues>({ defaultValues: saleDefaults });
  const mutation = useSellPackage(scope);
  const knownSaleId = saleRequestId ?? mutation.restoredSaleId;
  const [failure, setFailure] = useState<PackageSaleStatus>();
  const statusQuery = usePackageSaleStatus(scope, knownSaleId, (failed) => { setFailure(failed); setSaleRequestId(null); mutation.releaseFailed(knownSaleId); });
  const status = { ...statusQuery, data: statusQuery.data ?? failure };
  const pending = mutation.isPending || (knownSaleId !== null && status.data?.status !== 'completed' && status.data?.status !== 'failed');
  const locked = pending || mutation.recoveryRequired || mutation.restoring;
  const { recorder, recorderField } = usePackageSaleRecorderField(context?.recorders ?? [], locale, locked);
  const submitSale = packageSaleSubmission(form, locale, mutation, setSaleRequestId);
  const entryScope = serviceSessionAccessRevoked(contextError) ? null : context?.customer_entry_scope;
  const scopeKey = [scope.companyId, scope.userId, scope.businessId, scope.branchId, entryScope ?? ''].join('|');
  // اختيار قديم من نطاق تاني ما يتعرضش ولا يبدأ قراءة تحت النطاق الجديد.
  const customer = selection?.scopeKey === scopeKey ? selection.customer : null;
  if (selection !== null && customer === null) setSelection(null);
  const selectCustomer = (next: SessionCustomerSelection | null) => {
    setSelection(next === null ? null : { customer: next, scopeKey });
  };
  const onProfileAccessDenied = useCallback(() => {
    setSelection(null);
    void refreshContext();
  }, [refreshContext]);
  const selectType = (selected: SellablePackageType) => { setType(selected); form.setValue('price_paid', selected.price, { shouldDirty: true }); };
  const picker = usePackageSaleTypeOptions(scope, type, selectType, locked);
  // استرجاع البيع الأصلي بيبعت الطلب المحفوظ، فالعرض المحدّث ما بيمنعهوش
  const quoteStale = picker.quoteChanged && !mutation.recoveryRequired;
  const submit = form.handleSubmit((values) => submitSale(values, entryScope ? customer : null, type, recorder));
  const { onSubmit } = usePackageSaleSubmit({
    mutation,
    pending,
    quoteStale,
    clearFailure: () => setFailure(undefined),
    recordSaleRequestId: setSaleRequestId,
    submit,
  });
  return {
    entryScope,
    contextPending,
    customer,
    recorderField,
    saleRequestId: knownSaleId,
    form,
    mutation,
    status,
    pending,
    locked,
    picker,
    quoteStale,
    onSubmit,
    selectCustomer,
    setType,
    onProfileAccessDenied,
  };
}

function packageSaleSubmitLabel(locale: 'ar' | 'en', pending: boolean, recovery: boolean) {
  return t(
    locale,
    pending
      ? 'packageSale.submitting'
      : recovery
        ? 'packageSale.retryOriginal'
        : 'packageSale.submit',
  );
}

function packageSaleResult(
  status: Pick<ReturnType<typeof usePackageSaleStatus>, 'timedOut' | 'recheck' | 'error'> & {
    data: PackageSaleStatus | undefined;
  },
  saleRequestId: string | null,
) {
  return saleRequestId || status.data?.status === 'failed' ? (
    <PackageSaleResult
      status={status.data}
      timedOut={status.timedOut}
      recheck={status.recheck}
      error={status.error}
    />
  ) : null;
}

// الحقول الطويلة 12 عمودًا والمتوسطة 6 (design.md §6)، وتتكدس كلها في عمود واحد على الهاتف.
const FULL_CELL = 'col-span-12 min-w-0';
const HALF_CELL = 'col-span-12 flex min-w-0 flex-col gap-3 md:col-span-6';

export function PackageSaleForm({ scope }: { scope: SessionServiceScope }) {
  const locale = useLocale();
  const { entryScope, contextPending, customer, selectCustomer, recorderField, saleRequestId, form, mutation, status, pending, locked, picker, quoteStale, onSubmit, setType, onProfileAccessDenied } = usePackageSaleFormState(scope, locale);
  return (
    <form noValidate onSubmit={onSubmit} className="grid gap-4 text-start">
      <Card>
        <CardContent className="grid gap-6">
          <section className="grid gap-4">
            <h2 className="text-lg font-semibold">{t(locale, 'packageSale.sectionPackage')}</h2>
            <div className="grid grid-cols-12 gap-4">
              {recorderField ? <div className={HALF_CELL}>{recorderField}</div> : null}
              <div className={FULL_CELL}>
                {contextPending ? null : entryScope == null ? (
                  <p role="alert">{t(locale, 'packageSale.customerUnavailable')}</p>
                ) : (
                  <SessionCustomerField
                    {...scope}
                    packagesScope={scope}
                    entryScope={entryScope}
                    value={customer}
                    onChange={selectCustomer}
                    onAccessDenied={onProfileAccessDenied}
                    disabled={locked}
                  />
                )}
              </div>
              <div className={FULL_CELL}>
                <PackageSaleTypeField picker={picker} disabled={locked} onReconfirm={setType} />
              </div>
            </div>
          </section>
          <section className="grid gap-4">
            <h2 className="text-lg font-semibold">{t(locale, 'packageSale.sectionPayment')}</h2>
            <PackageSaleFields scope={scope} form={form} disabled={locked} />
          </section>
          {form.formState.errors.root ? (
            <p role="alert">{form.formState.errors.root.message}</p>
          ) : null}
          <PackageSaleRecoveryNotice mutation={mutation} status={status.data?.status} />
        </CardContent>
        <CardFooter>
          <Button className="ms-auto" type="submit" disabled={pending || mutation.restoring || mutation.verificationRequired || quoteStale || saleRequestId !== null || (!entryScope && !mutation.recoveryRequired) || status.data?.status === 'completed'}>
            {packageSaleSubmitLabel(locale, pending, mutation.recoveryRequired)}
          </Button>
        </CardFooter>
      </Card>
      {packageSaleResult(status, saleRequestId)}
    </form>
  );
}
