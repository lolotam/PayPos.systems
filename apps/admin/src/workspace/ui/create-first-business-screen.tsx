'use client';

import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, PageHeader, PageShell } from '@pospay/ui';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

import { isForbidden, issueField } from '../api/create-company-client';
import { useCreateBusiness } from '../api/use-first-setup';
import { CreateFirstBusinessForm } from './create-first-business-form';

/** شاشة أول نشاط: بتظهر للشركة المختارة اللي ملهاش أنشطة، والرفض بيتعرض بعد المحاولة نفسها. */
export function CreateFirstBusinessScreen({ companyId }: { companyId: string }) {
  const locale = useLocale();
  const create = useCreateBusiness(companyId);
  const error = create.error;
  const forbidden = isForbidden(error);
  const field = issueField(error);
  const alertTitle = forbidden
    ? t(locale, 'admin.firstBusinessForbidden')
    : error === null || error === undefined
      ? null
      : envelopeMessage(error, locale);
  // الإنشاء نجح والدولة هي اللي فشلت: النشاط مفيش له لازمة تتلغي، والرسالة بتقول إنها تنحفظ
  // لاحقًا من الإعدادات — والانسياب بيكمل للخطوة اللي بعدها لما القراءة المحدّثة توصل.
  const countryFailed = create.data !== undefined && create.data !== null && !create.data.countrySaved;
  return (
    <PageShell layout="form">
      <PageHeader
        title={t(locale, 'admin.firstBusinessTitle')}
        description={t(locale, 'admin.firstBusinessLead')}
      />
      {alertTitle ? (
        <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={alertTitle} className="p-4" />
      ) : null}
      {countryFailed ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={t(locale, 'admin.businessCountryNotSaved')}
          className="p-4"
        />
      ) : null}
      <CreateFirstBusinessForm
        pending={create.isPending}
        serverField={field}
        onSave={(call) => create.mutate(call)}
      />
    </PageShell>
  );
}
