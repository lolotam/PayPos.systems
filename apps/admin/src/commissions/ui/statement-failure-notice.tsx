'use client';

import type { CommissionStatementEmployee } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';
import { employeeName } from '../model/statement-display';
import { issueKey, type StatementFailure } from '../model/statement-messages';

const NS = 'commissionStatementScreen';

/**
 * رفض السيرفر بنص مقروء: الرسالة، وقائمة المشاكل لو الكشف موقوف (الموظفة وسببها)، وعدد بنود الخدمة الناقصة،
 * وزرار تحميل من جديد لما البصمة تكون قديمة. الكود الخام ما بيظهرش.
 */
export function StatementFailureNotice({
  failure,
  employees,
  onReload,
}: {
  failure: StatementFailure;
  employees: readonly CommissionStatementEmployee[];
  onReload(): void;
}) {
  const locale = useLocale();
  const nameOf = (id: string) => {
    const match = employees.find((employee) => employee.employee_id === id);
    return match === undefined ? null : employeeName(match, locale);
  };
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-card border border-border p-3">
      <p>{failure.text}</p>
      {failure.issues.length > 0 ? (
        <ul className="list-disc ps-5">
          {failure.issues.map((issue) => (
            <li key={`${issue.employeeId}:${issue.code}`}>
              {[nameOf(issue.employeeId), t(locale, issueKey(issue.code))].filter(Boolean).join(': ')}
            </li>
          ))}
        </ul>
      ) : null}
      {failure.lineCount > 0 ? (
        <p>
          {t(locale, `${NS}.issueBlockedLines`)} <bdi>{failure.lineCount}</bdi>
        </p>
      ) : null}
      {failure.stale ? (
        <Button variant="outline" onClick={onReload}>
          {t(locale, `${NS}.reload`)}
        </Button>
      ) : null}
    </div>
  );
}
