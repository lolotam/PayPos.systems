'use client';

import { t } from '@pospay/i18n';
import { CircleAlert, EmptyState, PageHeader, PageShell } from '@pospay/ui';

import { envelopeMessage } from '@/shared/api/api-error';
import { useMounted } from '@/shared/browser/use-mounted';
import { useLocale } from '@/shared/locale/locale-context';
import { useSessionIdentity } from '@/session/api/use-session';

import { isForbidden, issueField } from '../api/create-company-client';
import { useCreateCompany } from '../api/use-create-company';
import { useWorkspaces } from '../api/use-workspaces';
import { useStoredAttempt } from '../model/create-company-attempt';
import { CreateCompanyForm } from './create-company-form';
import { CreateCompanySuccess } from './create-company-success';

export function CreateCompanyScreen() {
  const locale = useLocale();
  const mounted = useMounted();
  const identity = useSessionIdentity(mounted);
  const userId = identity.status === 'settled' ? (identity.userId ?? undefined) : undefined;
  const workspaces = useWorkspaces(mounted);
  const create = useCreateCompany(userId);
  const stored = useStoredAttempt(userId, create.isPending, create.isSuccess, create.isError);
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
  if (create.isSuccess) {
    return (
      <CreateCompanySuccess
        reload={workspaces.isError || workspaces.isPending}
        onReload={() => {
          void workspaces.refetch();
        }}
      />
    );
  }
  return (
    <PageShell layout="form">
      <PageHeader
        title={t(locale, 'admin.createCompanyTitle')}
        description={t(locale, 'admin.createCompanyLead')}
      />
      {alertTitle ? (
        <EmptyState role="alert" tone="danger" icon={<CircleAlert />} title={alertTitle} className="p-4" />
      ) : null}
      {stored !== null ? <p role="status">{t(locale, 'admin.createCompanyRetryNotice')}</p> : null}
      <CreateCompanyForm
        pending={create.isPending}
        locked={stored !== null}
        lockedBody={stored?.body ?? null}
        serverField={field}
        onSave={(input) => create.mutate({ kind: 'new', body: input })}
        onRetry={() => create.mutate({ kind: 'retry' })}
      />
    </PageShell>
  );
}
