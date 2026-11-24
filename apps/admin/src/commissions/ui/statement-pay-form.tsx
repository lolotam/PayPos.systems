'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import type { CommissionStatementEmployee, MarkCommissionStatementPaidInput } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useMemo, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
import { payFormSchema } from '../model/statement-pay-schema';
import { todayInputDate } from '../model/statement-period';
import { StatementPayFields } from './statement-pay-fields';
import { StatementPaySummary } from './statement-pay-summary';

const NS = 'commissionStatementScreen';

/**
 * فورم تسجيل الصرف: قبل التأكيد بيظهر صافي كل موظفة ومجموع الكشف، وبعدها خانات الصرف. الفحص من عقد الطلب
 * نفسه، فالتأكيد مقفول لحد ما الطريقة تتحدد والتاريخ يصح. رد السيرفر بيتحط في `children`.
 */
export function StatementPayForm({
  employees,
  approvedAt,
  pending,
  onSubmit,
  onCancel,
  children,
}: {
  employees: readonly CommissionStatementEmployee[];
  approvedAt: string | undefined;
  pending: boolean;
  onSubmit(body: MarkCommissionStatementPaidInput): void;
  onCancel(): void;
  children?: ReactNode;
}) {
  const locale = useLocale();
  const schema = useMemo(() => payFormSchema(approvedAt), [approvedAt]);
  const form = useForm<MarkCommissionStatementPaidInput>({
    resolver: zodResolver(schema),
    mode: 'onChange',
    defaultValues: { paid_on: todayInputDate(new Date()) },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <StatementPaySummary employees={employees} />
      <StatementPayFields form={form} pending={pending} approvedAt={approvedAt} />
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
