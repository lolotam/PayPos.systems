'use client';

import type { CommissionStatementIssue } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { useLocale } from '@/shared/locale/locale-context';
import { issueKey } from '../model/statement-messages';

/** سطر نص المشكلة: خطة أو مرتب ناقص، أو تصحيح موقوف من شهر معيّن. */
function issueText(issue: CommissionStatementIssue, locale: 'ar' | 'en'): string {
  if (issue.kind === 'BLOCKED_CORRECTION') {
    return `${t(locale, 'commissionStatementScreen.issueBlockedCorrection')} ${issue.source_period ?? ''}`.trim();
  }
  return t(locale, issueKey(issue.code));
}

/** مشاكل الموظفة اللي بتمنع المراجعة والاعتماد، ظاهرة قبل أي ضغطة. */
export function StatementIssues({ issues }: { issues: readonly CommissionStatementIssue[] }) {
  const locale = useLocale();
  if (issues.length === 0) return null;
  return (
    <div role="alert" className="rounded-card border border-border p-3">
      <p className="font-semibold">{t(locale, 'commissionStatementScreen.issuesTitle')}</p>
      <ul className="list-disc ps-5">
        {issues.map((issue) => (
          <li key={`${issue.kind}:${issue.code}:${issue.source_period ?? ''}`}>{issueText(issue, locale)}</li>
        ))}
      </ul>
    </div>
  );
}
