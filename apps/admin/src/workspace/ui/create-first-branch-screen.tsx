'use client';

import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, PageHeader, PageShell } from '@pospay/ui';
import { useEffect } from 'react';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

import { isForbidden, issueField } from '../api/create-company-client';
import { useCreateBranch } from '../api/use-first-setup';
import { clearUnsavedCountry } from '../model/country-outcome';
import { CountryNotSavedAlert } from './country-not-saved-alert';
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
  // الخروج من سيل الإعداد (تركيب الفرع أو تغيير مساحة العمل) بينضف سجل نتيجة الدولة.
  useEffect(() => {
    return () => clearUnsavedCountry(businessId);
  }, [businessId]);
  return (
    <PageShell layout="form">
      <PageHeader
        title={t(locale, 'admin.firstBranchTitle')}
        description={t(locale, 'admin.firstBranchLead')}
      />
      <CountryNotSavedAlert companyId={companyId} businessId={businessId} />
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
