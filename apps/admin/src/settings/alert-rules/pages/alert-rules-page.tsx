'use client';

import type { WorkspaceBranch } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { PageHeader } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { useAlertRules } from '../api/use-alert-rules';
import { useRatingSettings } from '../api/use-rating-settings';
import { isAlertRulesRefusal } from '../model/alert-rules-failure';
import { AlertRulesForm } from '../ui/alert-rules-form';
import { AlertRulesLoadError } from '../ui/alert-rules-load-error';
import { AlertsMasterSwitch } from '../ui/alerts-master-switch';
import { RatingRequestsSwitch } from '../ui/rating-requests-switch';
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
  const rating = useRatingSettings(props.companyId, props.userId, props.businessId);
  const server = query.data;
  const refused = query.isError && isAlertRulesRefusal(query.error);
  const ratingRefused = rating.isError && isAlertRulesRefusal(rating.error);
  // رفض التنبيهات ورفض مفتاح التقييم مش بعض: رسالة التنبيهات بتتبان بس لما اترفض على الاتنين،
  // وإلا هي مش بتاعته أصلاً (RT-Q13: صلاحية مفتاح التقييم منفصلة).
  const alertRulesError = query.isError && (!refused || ratingRefused);
  return (
    <section className="flex min-w-0 flex-col gap-8 text-start">
      <PageHeader
        title={t(locale, 'alertRules.title')}
        description={t(locale, 'alertRules.lead')}
      />
      {refused ? null : (
        <ScopeSelector branches={props.branches} value={branchId} onChange={setBranchId} />
      )}
      {query.isPending ? <p role="status">{t(locale, 'admin.loading')}</p> : null}
      {alertRulesError ? (
        <AlertRulesLoadError
          error={query.error}
          refused={refused}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {/* الكارت بره بلوك التنبيهات: صلاحية طلبات التقييم منفصلة، فلو اترفضت صلاحية التنبيهات يفضل الكارت شغال. */}
      <RatingRequestsSwitch
        companyId={props.companyId}
        userId={props.userId}
        businessId={props.businessId}
      />
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
