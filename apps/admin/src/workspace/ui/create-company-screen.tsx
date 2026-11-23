'use client';

import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, PageHeader, PageShell } from '@pospay/ui';

import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';

import { isForbidden, issueField } from '../api/create-company-client';
import { useCreateCompany } from '../api/use-create-company';
import { CreateCompanyForm } from './create-company-form';

export function CreateCompanyScreen() {
  const locale = useLocale();
  const create = useCreateCompany();
  const error = create.error;
  // مفيش endpoint يسأل عن صلاحية الإنشاء قبل المحاولة، فالشاشة بتظهر لكل مستخدم مسجّل من غير
  // شركة و403 بيترجّع بعد المحاولة نفسها، وحقل الاسم المرفوض من السيرفر بيرجع لنص حقلته.
  const forbidden = isForbidden(error);
  const field = issueField(error);
  const alertTitle = forbidden
    ? t(locale, 'admin.createCompanyForbidden')
    : error === null || error === undefined
      ? null
      : envelopeMessage(error, locale);
  return (
    <PageShell layout="form">
      <PageHeader
        title={t(locale, 'admin.createCompanyTitle')}
        description={t(locale, 'admin.createCompanyLead')}
      />
      {alertTitle ? (
        <EmptyState
          role="alert"
          tone="danger"
          icon={<CircleAlert />}
          title={alertTitle}
          className="p-4"
        />
      ) : null}
      <CreateCompanyForm
        pending={create.isPending}
        serverField={field}
        onSave={(input) => create.mutate(input)}
      />
    </PageShell>
  );
}
