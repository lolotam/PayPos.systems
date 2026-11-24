'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CommissionStatementReturnInput } from '@pospay/contracts';
import { t, type MessageKey } from '@pospay/i18n';
import { Button, Label } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { returnReasonForm } from '../model/statement-return-schema';

const NS = 'commissionStatementScreen';

/**
 * فورم سبب الإرجاع للمسودة: السبب إلزامي لحد 500 حرف بعد القص، والفحص بيشتغل مع كل تعديل والرسالة بتطلع
 * تحت الخانة، وزرار التأكيد مقفول لحد ما السبب يصح أو طول ما الأمر شغّال. رد السيرفر بيتحط في `children`.
 */
export function StatementReturnForm({
  pending,
  onSubmit,
  onCancel,
  children,
}: {
  pending: boolean;
  onSubmit(body: CommissionStatementReturnInput): void;
  onCancel(): void;
  children?: ReactNode;
}) {
  const locale = useLocale();
  const form = useForm<CommissionStatementReturnInput>({
    resolver: zodResolver(returnReasonForm),
    mode: 'onChange',
    defaultValues: { reason: '' },
  });
  const problem = form.formState.errors.reason?.message;
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="statement-return-reason">{t(locale, `${NS}.returnReasonLabel`)}</Label>
        <textarea
          id="statement-return-reason"
          rows={3}
          disabled={pending}
          aria-invalid={problem !== undefined}
          className="rounded-interactive border border-input bg-background ps-3 pe-3 py-2"
          {...form.register('reason')}
        />
        <p className="text-sm text-muted-foreground">{t(locale, `${NS}.returnReasonHint`)}</p>
        {problem !== undefined ? <p role="alert">{t(locale, problem as MessageKey)}</p> : null}
      </div>
      {children}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!form.formState.isValid || pending}>
          {pending ? t(locale, `${NS}.working`) : t(locale, `${NS}.confirm`)}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
          {t(locale, `${NS}.cancel`)}
        </Button>
      </div>
    </form>
  );
}
