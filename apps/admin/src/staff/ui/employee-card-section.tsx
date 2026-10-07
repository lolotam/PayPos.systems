'use client';
import { t } from '@pospay/i18n';
import { Button, Card, CardContent } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeCards } from '../api/use-employee-cards';
import { EmployeeCardForm } from './employee-card-form';

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
  if (!view.isFetchedAfterMount || view.data === undefined || view.isError) return null;
  const active = view.data.active;
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6 text-start">
        <h3 className="text-lg font-semibold">{t(locale, 'employeeCard.title')}</h3>
        <p className="text-sm text-muted-foreground">{t(locale, 'employeeCard.lead')}</p>
        {active === null ? (
          <p>{t(locale, 'employeeCard.none')}</p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span>
              {t(locale, 'employeeCard.active')}
              {active.card_code_suffix ? `: ••••${active.card_code_suffix}` : ''}
            </span>
            {view.data.can_manage ? (
              <Button
                variant="destructive"
                size="sm"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(active.id)}
              >
                {t(locale, 'employeeCard.revoke')}
              </Button>
            ) : null}
          </div>
        )}
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
