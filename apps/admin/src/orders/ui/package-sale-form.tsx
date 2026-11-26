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

/** اختيار الزبونة ما بينتقلش بين النطاقات، ورفض القراءة يرجّع الاختيار ويطلب قراءة جديدة. */
function usePackageSaleCustomerSelection(
  scope: SessionServiceScope,
  entryScope: string | null | undefined,
  refreshContext: () => void,
) {
  const [selection, setSelection] = useState<{
    customer: SessionCustomerSelection;
    scopeKey: string;
  } | null>(null);
  const scopeKey = [
    scope.companyId,
    scope.userId,
    scope.businessId,
    scope.branchId,
    entryScope ?? '',
  ].join('|');
  const customer = selection?.scopeKey === scopeKey ? selection.customer : null;
  if (selection !== null && customer === null) setSelection(null);
  const selectCustomer = (next: SessionCustomerSelection | null) =>
    setSelection(next === null ? null : { customer: next, scopeKey });
  const onProfileAccessDenied = useCallback(() => {
    setSelection(null);
    refreshContext();
  }, [refreshContext]);
  return { customer, selectCustomer, onProfileAccessDenied };
}

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

/**
 * السعر اللي لسه تلقائي بيتحدّث مع العرض الجديد؛ سعر كتبته الموظفة بيفضل زي ما هو لأن العرض الجديد مش بيلغي اختياره.
 *
 * @param form فورم البيع
 * @param previous الباقة المختارة قبل التحديث
 * @param refreshed الباقة بالعرض الجديد
 */
function refreshTypePrice(
  form: UseFormReturn<PackageSaleFieldValues>,
  previous: SellablePackageType | null,
  refreshed: SellablePackageType,
): void {
  const current = form.getValues('price_paid');
  if (previous === null) return;
  if (current === previous.price || normalizeKwdInput(current) === previous.price)
    form.setValue('price_paid', refreshed.price, { shouldDirty: true });
}

function usePackageSaleStatusAndLock(scope: SessionServiceScope) {
  const [saleRequestId, setSaleRequestId] = useState<string | null>(null);
  const mutation = useSellPackage(scope);
  const knownSaleId = saleRequestId ?? mutation.restoredSaleId;
  const [failure, setFailure] = useState<PackageSaleStatus>();
  const statusQuery = usePackageSaleStatus(scope, knownSaleId, (failed) => {
    setFailure(failed);
    setSaleRequestId(null);
    mutation.releaseFailed(knownSaleId);
  });
  const status = { ...statusQuery, data: statusQuery.data ?? failure };
  const pending =
    mutation.isPending ||
    (knownSaleId !== null &&
      status.data?.status !== 'completed' &&
      status.data?.status !== 'failed');
  return {
    saleRequestId: knownSaleId,
    setSaleRequestId,
    mutation,
    status,
    pending,
    locked: pending || mutation.recoveryRequired || mutation.restoring,
    clearFailure: () => setFailure(undefined),
  };
}

function usePackageSaleFormState(scope: SessionServiceScope, locale: 'ar' | 'en') {
  const [type, setType] = useState<SellablePackageType | null>(null);
  const {
    data: context,
    error: contextError,
    isPending: contextPending,
    refetch,
  } = usePackageSaleContext(scope);
  const form = useForm<PackageSaleFieldValues>({ defaultValues: saleDefaults });
  const sale = usePackageSaleStatusAndLock(scope);
  const { recorder, recorderField } = usePackageSaleRecorderField(
    context?.recorders ?? [],
    locale,
    sale.locked,
  );
  const submitSale = packageSaleSubmission(form, locale, sale.mutation, sale.setSaleRequestId);
  const entryScope = serviceSessionAccessRevoked(contextError)
    ? null
    : context?.customer_entry_scope;
  const customerState = usePackageSaleCustomerSelection(scope, entryScope, refetch);
  const selectType = (selected: SellablePackageType) => {
    setType(selected);
    form.setValue('price_paid', selected.price, { shouldDirty: true });
  };
  // إعادة تأكيد العرض الجديد بتحدّث السعر بس لو السعر لسه زي السعر القديم التلقائي؛
  // سعر عدّله المستخدم بيفضل زي ما هو لأن العرض الجديد مش بيلغي اختياره.
  const reconfirmType = (refreshed: SellablePackageType) => {
    setType(refreshed);
    refreshTypePrice(form, type, refreshed);
  };
  const picker = usePackageSaleTypeOptions(scope, type, selectType, sale.locked);
  // استرجاع البيع الأصلي بيبعت الطلب المحفوظ، فالعرض المحدّث ما بيمنعهوش
  const quoteStale = picker.quoteChanged && !sale.mutation.recoveryRequired;
  const submit = form.handleSubmit((values) =>
    submitSale(values, entryScope ? customerState.customer : null, type, recorder),
  );
  const { onSubmit } = usePackageSaleSubmit({
    mutation: sale.mutation,
    pending: sale.pending,
    quoteStale,
    clearFailure: sale.clearFailure,
    recordSaleRequestId: sale.setSaleRequestId,
    submit,
  });
  return {
    entryScope,
    contextPending,
    customerState,
    recorderField,
    form,
    ...sale,
    picker,
    quoteStale,
    onSubmit,
    reconfirmType,
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

function PackageSaleCustomerCell({
  scope,
  entryScope,
  contextPending,
  locked,
  customerState,
  locale,
}: {
  scope: SessionServiceScope;
  entryScope: ReturnType<typeof usePackageSaleFormState>['entryScope'];
  contextPending: boolean;
  locked: boolean;
  customerState: ReturnType<typeof usePackageSaleCustomerSelection>;
  locale: 'ar' | 'en';
}) {
  if (contextPending) return null;
  if (entryScope == null) return <p role="alert">{t(locale, 'packageSale.customerUnavailable')}</p>;
  return (
    <SessionCustomerField
      {...scope}
      packagesScope={scope}
      entryScope={entryScope}
      value={customerState.customer}
      onChange={customerState.selectCustomer}
      onAccessDenied={customerState.onProfileAccessDenied}
      disabled={locked}
    />
  );
}

export function PackageSaleForm({ scope }: { scope: SessionServiceScope }) {
  const locale = useLocale();
  const s = usePackageSaleFormState(scope, locale);
  const submitDisabled =
    s.pending ||
    s.mutation.restoring ||
    s.mutation.verificationRequired ||
    s.quoteStale ||
    s.saleRequestId !== null ||
    (!s.entryScope && !s.mutation.recoveryRequired) ||
    s.status.data?.status === 'completed';
  return (
    <form noValidate onSubmit={s.onSubmit} className="grid gap-4 text-start">
      <Card>
        <CardContent className="grid gap-6">
          <section className="grid gap-4">
            <h2 className="text-lg font-semibold">{t(locale, 'serviceSessions.packagePicker')}</h2>
            <div className="grid grid-cols-12 gap-4">
              {s.recorderField ? <div className={HALF_CELL}>{s.recorderField}</div> : null}
              <div className={FULL_CELL}>
                <PackageSaleCustomerCell
                  scope={scope}
                  entryScope={s.entryScope}
                  contextPending={s.contextPending}
                  locked={s.locked}
                  customerState={s.customerState}
                  locale={locale}
                />
              </div>
              <div className={FULL_CELL}>
                <PackageSaleTypeField
                  picker={s.picker}
                  disabled={s.locked}
                  onReconfirm={s.reconfirmType}
                />
              </div>
            </div>
          </section>
          <section className="grid gap-4">
            <h2 className="text-lg font-semibold">{t(locale, 'packageSale.sectionPayment')}</h2>
            <PackageSaleFields scope={scope} form={s.form} disabled={s.locked} />
          </section>
          {s.form.formState.errors.root ? (
            <p role="alert">{s.form.formState.errors.root.message}</p>
          ) : null}
          <PackageSaleRecoveryNotice mutation={s.mutation} status={s.status.data?.status} />
        </CardContent>
        <CardFooter>
          <Button className="ms-auto" type="submit" disabled={submitDisabled}>
            {packageSaleSubmitLabel(locale, s.pending, s.mutation.recoveryRequired)}
          </Button>
        </CardFooter>
      </Card>
      {packageSaleResult(s.status, s.saleRequestId)}
    </form>
  );
}
