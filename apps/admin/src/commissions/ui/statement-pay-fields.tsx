'use client';

import { commissionStatementPaidMethod, type MarkCommissionStatementPaidInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Input, Label, NativeSelect } from '@pospay/ui';
import type { UseFormReturn } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { paidMethodKey } from '../model/statement-display';

const NS = 'commissionStatementScreen';

/** خانة فاضية معناها «ما اتحددش»، فالعقد هو اللي يقول إنها ناقصة بدل ما نبعت نص فاضي. */
const emptyAsMissing = (value: unknown) => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/**
 * خانات بيانات الصرف: طريقة الصرف إلزامية من غير اختيار مسبق ومعاها ملاحظة تقريب الكاش، وتاريخ الصرف
 * وتلميح نافذته (من يوم الاعتماد لحد النهارده، إرشاد بس والسيرفر هو اللي يفصل)، والملاحظة الاختيارية.
 */
export function StatementPayFields({
  form,
  pending,
}: {
  form: UseFormReturn<MarkCommissionStatementPaidInput>;
  pending: boolean;
}) {
  const locale = useLocale();
  const errors = form.formState.errors;
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor="statement-pay-method">{t(locale, `${NS}.payMethodLabel`)}</Label>
        <NativeSelect id="statement-pay-method" disabled={pending} {...form.register('paid_method', { setValueAs: emptyAsMissing })}>
          <option value="">{t(locale, `${NS}.payMethodChoose`)}</option>
          {commissionStatementPaidMethod.options.map((method) => (
            <option key={method} value={method}>
              {t(locale, paidMethodKey(method))}
            </option>
          ))}
        </NativeSelect>
        <p className="text-sm text-muted-foreground">{t(locale, `${NS}.payCashNote`)}</p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="statement-pay-date">{t(locale, `${NS}.payPaidOnLabel`)}</Label>
        <Input id="statement-pay-date" type="date" disabled={pending} aria-invalid={errors.paid_on !== undefined} {...form.register('paid_on')} />
        <p className="text-sm text-muted-foreground">{t(locale, `${NS}.payPaidOnHint`)}</p>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="statement-pay-note">{t(locale, `${NS}.payNoteLabel`)}</Label>
        <textarea
          id="statement-pay-note"
          rows={2}
          disabled={pending}
          aria-invalid={errors.paid_note !== undefined}
          className="rounded-interactive border border-input bg-background ps-3 pe-3 py-2"
          {...form.register('paid_note', { setValueAs: emptyAsMissing })}
        />
        <p className="text-sm text-muted-foreground">{t(locale, `${NS}.payNoteHint`)}</p>
        {errors.paid_note !== undefined ? <p role="alert">{t(locale, `${NS}.payNoteInvalid`)}</p> : null}
      </div>
    </>
  );
}
