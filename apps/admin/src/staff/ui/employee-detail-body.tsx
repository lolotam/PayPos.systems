'use client';
import type { WorkspaceBusinessRead } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Card, CircleAlert, EmptyState, LoaderCircle } from '@pospay/ui';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { useEmployeeEdit } from '../api/use-employees';
import type { EmployeeDetailTab, EmployeeSectionScope } from '../model/employee-detail-tabs';
import { EmployeeDetailTabContent } from './employee-detail-tab-content';

/** بطاقة التبويب الحالي: حالة قراءة الموظف أولًا ثم أقسام التبويب؛ تبويب «الإجازات» يُركَّب بعد انتهاء القراءة حتى لو فشلت. */
export function EmployeeDetailBody({
  tab,
  scope,
  business,
  edit,
}: {
  tab: EmployeeDetailTab;
  scope: EmployeeSectionScope;
  business: WorkspaceBusinessRead;
  edit: ReturnType<typeof useEmployeeEdit>;
}) {
  const locale = useLocale();
  const { record } = edit;
  return (
    <Card className="flex flex-col gap-4 p-6">
      {record.isPending ? (
        <EmptyState icon={<LoaderCircle />} role="status" title={t(locale, 'admin.loading')} />
      ) : null}
      {record.isError && tab !== 'leave' ? (
        <EmptyState
          icon={<CircleAlert />}
          role="alert"
          tone="danger"
          title={envelopeMessage(record.error, locale)}
        />
      ) : null}
      <EmployeeDetailTabContent tab={tab} scope={scope} business={business} edit={edit} />
    </Card>
  );
}
