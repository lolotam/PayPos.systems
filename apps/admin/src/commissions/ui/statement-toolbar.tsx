'use client';

import { t } from '@pospay/i18n';
import { Input, Label } from '@pospay/ui';
import type { ReactNode } from 'react';
import { useLocale } from '@/shared/locale/locale-context';

/** شهر YYYY-MM كامل: الشهر اللي خانة الشهر ما بتسلّمهوش ناقص بيتعامل كإنه لسه مختارش. */
const FULL_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** شريط الشاشة: اختيار الشهر وجنبه حالة الكشف. */
export function StatementToolbar({
  period,
  onPeriod,
  status,
}: {
  period: string;
  onPeriod(period: string): void;
  status: ReactNode;
}) {
  const locale = useLocale();
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor="statement-month">{t(locale, 'commissionStatementScreen.monthLabel')}</Label>
        <Input
          id="statement-month"
          type="month"
          value={period}
          onChange={(event) => {
            if (FULL_MONTH.test(event.target.value)) onPeriod(event.target.value);
          }}
        />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">{t(locale, 'commissionStatementScreen.statusLabel')}</span>
        {status}
      </div>
    </div>
  );
}
