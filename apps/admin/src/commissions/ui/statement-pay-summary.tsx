'use client';

import type { CommissionStatementEmployee } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { employeeName, formatAmount } from '../model/statement-display';
import { sumAmounts } from '../model/statement-sum';

const NS = 'commissionStatementScreen';

/**
 * اللي هيتصرف لكل موظفة قبل التأكيد: صافي كل واحدة زي ما السيرفر رجّعه في الكشف، ومجموع الكشف من الصوافي دي
 * (من غير تقريب الكاش، لأن السيرفر هو اللي بيقرّبه وبيرجّع المتصرف فعلاً).
 */
export function StatementPaySummary({ employees }: { employees: readonly CommissionStatementEmployee[] }) {
  const locale = useLocale();
  return (
    <div className="flex flex-col gap-1 rounded-card border border-border p-3">
      <p className="font-semibold">{t(locale, `${NS}.payPreviewTitle`)}</p>
      <ul>
        {employees.map((employee) => (
          <li key={employee.employee_id} className="flex justify-between gap-2">
            <span>{employeeName(employee, locale)}</span>
            <span dir="ltr">{formatAmount(employee.payable)}</span>
          </li>
        ))}
      </ul>
      <p className="flex justify-between gap-2 border-t border-border pt-1 font-semibold">
        <span>{t(locale, `${NS}.payPreviewTotal`)}</span>
        <span dir="ltr">{formatAmount(sumAmounts(employees.map((employee) => employee.payable)))}</span>
      </p>
    </div>
  );
}
