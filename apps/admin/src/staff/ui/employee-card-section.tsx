'use client';
import { t } from '@pospay/i18n';
import { Card, CardContent } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeCards } from '../api/use-employee-cards';
import { ActiveCardStatus } from './active-card-status';
import { EmployeeCardForm } from './employee-card-form';
import { EmployeeCardRevokeDialog } from './employee-card-revoke-dialog';

// قسم كارت الحضور داخل شاشة الموظف: الإصدار يستبدل النشط، والإلغاء يحتاج الإدارة.
export function EmployeeCardSection({
  companyId,
  businessId,
  userId,
  employeeId,
}: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
}) {
  const locale = useLocale();
  const { view, issue, revoke } = useEmployeeCards(companyId, businessId, userId, employeeId);
  const [confirmingCardId, setConfirmingCardId] = useState<string | null>(null);
  if (!view.isFetchedAfterMount || view.data === undefined || view.isError) return null;
  const active = view.data.active;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 text-start">
        <h3 className="text-lg font-semibold">{t(locale, 'employeeCard.title')}</h3>
        <p className="text-sm text-muted-foreground">{t(locale, 'employeeCard.lead')}</p>
        <ActiveCardStatus
          active={active}
          canManage={view.data.can_manage}
          revoking={revoke.isPending}
          onStartRevoke={setConfirmingCardId}
        />
        {active !== null && view.data.can_manage && confirmingCardId === active.id ? (
          <EmployeeCardRevokeDialog
            locale={locale}
            onClose={() => setConfirmingCardId(null)}
            onConfirm={() => {
              setConfirmingCardId(null);
              revoke.mutate(active.id);
            }}
          />
        ) : null}
        {view.data.can_manage ? (
          <EmployeeCardForm
            pending={issue.isPending}
            error={issue.isError ? issue.error : null}
            onIssue={(code) => issue.mutate({ card_code: code })}
          />
        ) : null}
        {revoke.isError ? <p role="alert">{envelopeMessage(revoke.error, locale)}</p> : null}
        {issue.isSuccess ? <p role="status">{t(locale, 'employeeCard.issued')}</p> : null}
      </CardContent>
    </Card>
  );
}
