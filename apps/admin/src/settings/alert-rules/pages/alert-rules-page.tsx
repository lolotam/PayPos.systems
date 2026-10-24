'use client';

import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button, PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useAlertRules } from '../api/use-alert-rules';
import { alertRulesFailureMessage, isAlertRulesRefusal } from '../model/alert-rules-failure';
import { AlertRulesForm } from '../ui/alert-rules-form';
import { AlertsMasterSwitch } from '../ui/alerts-master-switch';
import { ScopeSelector } from '../ui/scope-selector';

export function AlertRulesPage(props: {
  companyId: string;
  userId: string;
  businessId: string;
  branches: readonly WorkspaceBranch[];
}) {
  const locale = useLocale();
  const [branchId, setBranchId] = useState<string | null>(null);
  const query = useAlertRules(props.companyId, props.userId, props.businessId, branchId);
  const server = query.data;
  const refused = query.isError && isAlertRulesRefusal(query.error);
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <PageHeader title={t(locale, 'alertRules.title')} description={t(locale, 'alertRules.lead')} />
      <ScopeSelector branches={props.branches} value={branchId} onChange={setBranchId} />
      {query.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {query.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert">{alertRulesFailureMessage(query.error, locale)}</p>
          {refused ? null : (
            <Button type="button" variant="outline" onClick={() => void query.refetch()}>
              {t(locale, 'pos.retry')}
            </Button>
          )}
        </div>
      ) : null}
      {server && !refused ? (
        <>
          <AlertsMasterSwitch
            companyId={props.companyId}
            userId={props.userId}
            businessId={props.businessId}
            server={server}
          />
          <AlertRulesForm
            key={branchId ?? 'business'}
            companyId={props.companyId}
            userId={props.userId}
            businessId={props.businessId}
            branchId={branchId}
            server={server}
          />
        </>
      ) : null}
    </section>
  );
}
