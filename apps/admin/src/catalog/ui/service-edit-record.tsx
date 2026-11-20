'use client';
import type { Service, UpdateServiceInput } from '@pospay/contracts';
import type { UseMutationResult } from '@tanstack/react-query';
import { t } from '@pospay/i18n';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import type { ServiceCategoriesQuery } from '../api/use-service-categories';
import type { ServiceClosingInput } from '../api/use-service-closing';
import { EditServiceForm } from './edit-service-form';
import { ServiceClosingToggle } from './service-closing-toggle';

type ServiceEditRecordProps = {
  record: Service;
  categoryQuery: ServiceCategoriesQuery;
  save: UseMutationResult<Service, Error, UpdateServiceInput>;
  closing: UseMutationResult<Service, Error, ServiceClosingInput>;
  onSave: (terms: UpdateServiceInput) => void;
  onRequestClosing: (input: ServiceClosingInput) => void;
};

// جسم تعديل الخدمة: حالة القفل فوق نموذج التعديل، ومساحة نتيجة واحدة تحت الاثنين
// عشان رسالة القفل ورسالة الحفظ ما يظهروش مع بعض؛ والنموذج بيتعطل وقت تنفيذ القفل
// عشان الحفظ والقفل ما يبعتوش نفس النسخة المتوقعة، وتعديل متحفظاش بيمنع القفل.
export function ServiceEditRecord(props: ServiceEditRecordProps) {
  const locale = useLocale();
  const [formDirty, setFormDirty] = useState(false);
  const formPending = props.save.isPending || props.closing.isPending;
  return (
    <>
      <ServiceClosingToggle
        record={props.record}
        closing={props.closing}
        disabled={formPending || formDirty}
        dirty={formDirty}
        onRequest={props.onRequestClosing}
      />
      <EditServiceForm
        key={`${props.record.id}:${props.record.revision}`}
        categoryQuery={props.categoryQuery}
        record={props.record}
        pending={formPending}
        onDirtyChange={setFormDirty}
        onSave={props.onSave}
      />
      {props.closing.isError ? (
        <p role="alert">{envelopeMessage(props.closing.error, locale)}</p>
      ) : null}
      {props.closing.isSuccess && props.closing.data ? (
        <p role="status">
          {t(
            locale,
            props.closing.data.closed_at
              ? 'catalogServices.serviceClosed'
              : 'catalogServices.serviceReopened',
          )}
        </p>
      ) : null}
      {props.save.isError ? <p role="alert">{envelopeMessage(props.save.error, locale)}</p> : null}
      {props.save.isSuccess ? <p role="status">{t(locale, 'catalogServices.saved')}</p> : null}
    </>
  );
}
