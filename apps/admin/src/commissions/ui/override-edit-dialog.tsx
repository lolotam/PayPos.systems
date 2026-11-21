'use client';

import type { CommissionOverrideServiceItem } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import { useState } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { ModalDialog } from '@/shared/ui/modal-dialog';
import type { PlanScope } from '../api/plan-access';
import { useSaveCommissionOverride, type OverrideAttemptMemory } from '../api/use-save-commission-override';
import { overrideDraft } from '../model/override-draft';
import { OverrideForm } from './override-form';
import { OverrideHistoryList } from './override-history-list';
import { overrideServiceName } from './override-services-columns';

/**
 * حوار تعديل تجاوز خدمة واحدة: الحفظ بيقفل الحوار بس ما بيقفلوش، وبعد النجاح الفورم بيتأسّس
 * على القاعدة المحفوظة وتاريخ البداية يرجع يوم النشاط، والحوار بيفضل مفتوح.
 */
export function OverrideEditDialog(props: {
  scope: PlanScope;
  employeeId: string;
  timeZone: string;
  service: CommissionOverrideServiceItem;
  memory: OverrideAttemptMemory;
  onClose(): void;
}) {
  const { scope, employeeId, timeZone, service, memory, onClose } = props;
  const locale = useLocale();
  const save = useSaveCommissionOverride(scope, employeeId, memory);
  const [base, setBase] = useState(() => ({
    formKey: service.service_id,
    initial: overrideDraft(service.current_override, timeZone, new Date()),
  }));
  const onSaved = (row: NonNullable<typeof service.current_override>) =>
    setBase({ formKey: row.id, initial: overrideDraft(row, timeZone, new Date()) });
  const submit = (body: Parameters<typeof save.mutate>[0]['body']) =>
    save.mutate({ serviceId: service.service_id, body }, { onSuccess: onSaved });
  return (
    <ModalDialog title={t(locale, 'commissionOverrides.dialogTitle')} pending={save.isPending} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <span className="font-semibold">{overrideServiceName(service, locale)}</span>
        {service.closed_at !== null ? <Badge variant="neutral">{t(locale, 'commissionOverrides.closedBadge')}</Badge> : null}
        <OverrideForm
          key={base.formKey}
          serviceId={service.service_id}
          initial={base.initial}
          pending={save.isPending}
          serverError={save.error}
          onSubmit={submit}
          onClose={onClose}
        />
        {save.isSuccess ? <p role="status">{t(locale, 'commissionOverrides.saved')}</p> : null}
        <OverrideHistoryList scope={scope} employeeId={employeeId} serviceId={service.service_id} timeZone={timeZone} />
      </div>
    </ModalDialog>
  );
}
