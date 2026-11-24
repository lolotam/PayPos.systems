'use client';

import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, PageHeader, PageShell } from '@pospay/ui';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

import { isForbidden, issueField } from '../api/create-company-client';
import { useCreateBranch } from '../api/use-first-setup';
import { CreateFirstBranchForm } from './create-first-branch-form';

/** شاشة أول فرع: بتظهر للنشاط المختار اللي ملوش فروع، والرفض بيتعرض بعد المحاولة نفسها. */
export function CreateFirstBranchScreen({
  companyId,
  businessId,
}: {
  companyId: string;
  businessId: string;
}) {
  const locale = useLocale();
  const create = useCreateBranch(companyId, businessId);
  const error = create.error;
  // مفيش endpoint يسأل عن الصلاحية قبل المحاولة، فالرفض بيتعرض بعد الإرسال والنموذج بيفضل مليان.
  const forbidden = isForbidden(error);
  const field = issueField(error);
  const alertTitle = forbidden
    ? t(locale, 'admin.firstBranchForbidden')
    : error === null || error === undefined
      ? null
      : envelopeMessage(error, locale);
  return (
    <PageShell layout="form">
      <PageHeader
        title={t(locale, 'admin.firstBranchTitle')}
        description={t(locale, 'admin.firstBranchLead')}
      />
      {alertTitle ? (
        <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={alertTitle} className="p-4" />
      ) : null}
      <CreateFirstBranchForm
        pending={create.isPending}
        serverField={field}
        onSave={(body) => create.mutate(body)}
      />
    </PageShell>
  );
}
