'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  markCommissionStatementPaidInput,
  type CommissionStatementEmployee,
  type MarkCommissionStatementPaidInput,
} from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useLocale } from '@/shared/locale/locale-context';
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
  pending,
  onSubmit,
  onCancel,
  children,
}: {
  employees: readonly CommissionStatementEmployee[];
  pending: boolean;
  onSubmit(body: MarkCommissionStatementPaidInput): void;
  onCancel(): void;
  children?: ReactNode;
}) {
  const locale = useLocale();
  const form = useForm<MarkCommissionStatementPaidInput>({
    resolver: zodResolver(markCommissionStatementPaidInput),
    mode: 'onChange',
    defaultValues: { paid_on: todayInputDate(new Date()) },
  });
  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-3">
      <StatementPaySummary employees={employees} />
      <StatementPayFields form={form} pending={pending} />
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
