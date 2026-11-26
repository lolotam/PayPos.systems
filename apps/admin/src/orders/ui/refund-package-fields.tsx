'use client';
import { t, type Locale } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import { useId, type ReactNode } from 'react';
import { useWatch, type UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { componentName } from '../model/customer-package-view';
import {
  refundPreviewAmount,
  remainingFreeSessions,
  type RefundPackageComponent,
  type RefundPackageFormValues,
} from '../model/refund-package-values';

function RefundFieldRow({
  id,
  label,
  error,
  errorId,
  hint,
  hintId,
  children,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  errorId?: string | undefined;
  hint?: string | undefined;
  hintId?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && hintId ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error && errorId ? (
        <p id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** حقول استرداد الجلسات مع معاينة فورية للمبلغ بالملّات. */
export function RefundPackageForm({
  form,
  components,
  disabled,
}: {
  form: UseFormReturn<RefundPackageFormValues>;
  components: readonly RefundPackageComponent[];
  disabled: boolean;
}) {
  const locale = useLocale();
  const prefix = useId();
  const componentId = useWatch({ control: form.control, name: 'component_id' });
  const sessions = useWatch({ control: form.control, name: 'sessions' });
  const component = components.find((entry) => entry.id === componentId);
  const free = component === undefined ? 0 : remainingFreeSessions(component);
  const [previewBefore, previewAfter = ''] = t(locale, 'packageRefund.preview').split('{amount}');
  return (
    <div className="grid gap-3">
      <RefundComponentField
        form={form}
        components={components}
        prefix={prefix}
        disabled={disabled}
        locale={locale}
      />
      <RefundSessionsField
        form={form}
        free={free}
        prefix={prefix}
        disabled={disabled}
        locale={locale}
      />
      <RefundMethodField form={form} prefix={prefix} disabled={disabled} locale={locale} />
      <RefundReasonField form={form} prefix={prefix} disabled={disabled} locale={locale} />
      <p>
        {previewBefore}
        <bdi dir="ltr">{refundPreviewAmount(component, sessions)}</bdi>
        {previewAfter}
      </p>
    </div>
  );
}

type FieldProps = {
  form: UseFormReturn<RefundPackageFormValues>;
  prefix: string;
  disabled: boolean;
  locale: Locale;
};

function RefundComponentField({
  form,
  components,
  prefix,
  disabled,
  locale,
}: FieldProps & { components: readonly RefundPackageComponent[] }) {
  const error = form.formState.errors.component_id;
  return (
    <RefundFieldRow
      id={`${prefix}-component`}
      label={t(locale, 'packageRefund.component')}
      error={error ? t(locale, 'packageRefund.componentRequired') : undefined}
      errorId={`${prefix}-component-error`}
    >
      <NativeSelect
        id={`${prefix}-component`}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${prefix}-component-error` : undefined}
        {...form.register('component_id')}
      >
        <option value="">{t(locale, 'packageRefund.component')}</option>
        {components.map((entry) => (
          <option key={entry.id} value={entry.id}>
            {componentName(locale, entry)}
          </option>
        ))}
      </NativeSelect>
    </RefundFieldRow>
  );
}

function RefundSessionsField({
  form,
  free,
  prefix,
  disabled,
  locale,
}: FieldProps & { free: number }) {
  const error = form.formState.errors.sessions?.message;
  const message =
    error === undefined
      ? undefined
      : error === 'sessionsTooMany'
        ? t(locale, 'packageRefund.sessionsTooMany').replace('{available}', String(free))
        : t(locale, 'packageRefund.sessionsRequired');
  return (
    <RefundFieldRow
      id={`${prefix}-sessions`}
      label={t(locale, 'packageRefund.sessions')}
      error={message}
      errorId={`${prefix}-sessions-error`}
    >
      <Input
        id={`${prefix}-sessions`}
        type="number"
        dir="ltr"
        min={1}
        max={free}
        inputMode="numeric"
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${prefix}-sessions-error` : undefined}
        {...form.register('sessions', { valueAsNumber: true })}
      />
    </RefundFieldRow>
  );
}

function RefundMethodField({ form, prefix, disabled, locale }: FieldProps) {
  const error = form.formState.errors.method;
  return (
    <RefundFieldRow
      id={`${prefix}-method`}
      label={t(locale, 'packageRefund.method')}
      error={error ? t(locale, 'packageRefund.methodRequired') : undefined}
      errorId={`${prefix}-method-error`}
    >
      <NativeSelect
        id={`${prefix}-method`}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${prefix}-method-error` : undefined}
        {...form.register('method')}
      >
        <option value="CASH">{t(locale, 'packageRefund.methodCash')}</option>
        <option value="CARD">{t(locale, 'packageRefund.methodCard')}</option>
      </NativeSelect>
    </RefundFieldRow>
  );
}

function RefundReasonField({ form, prefix, disabled, locale }: FieldProps) {
  const error = form.formState.errors.reason?.message;
  const message =
    error === undefined
      ? undefined
      : t(
          locale,
          error === 'reasonTooLong'
            ? 'packageRefund.reasonTooLong'
            : 'packageRefund.reasonRequired',
        );
  return (
    <RefundFieldRow
      id={`${prefix}-reason`}
      label={t(locale, 'packageRefund.reason')}
      hint={t(locale, 'packageRefund.reasonHint')}
      hintId={`${prefix}-reason-hint`}
      error={message}
      errorId={`${prefix}-reason-error`}
    >
      <textarea
        id={`${prefix}-reason`}
        dir="auto"
        rows={4}
        disabled={disabled}
        aria-invalid={error !== undefined}
        aria-describedby={`${prefix}-reason-hint${error ? ` ${prefix}-reason-error` : ''}`}
        className="flex min-h-24 w-full rounded-interactive border border-input bg-card ps-3 pe-3 py-2 text-start text-base text-card-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
        {...form.register('reason')}
      />
    </RefundFieldRow>
  );
}
