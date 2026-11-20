'use client';
import type { Service, UpdateServiceInput } from '@pospay/contracts';
import type { ServiceCategoriesQuery } from '../api/use-service-categories';
import { EditServiceForm } from './edit-service-form';
import { ServiceClosingToggle } from './service-closing-toggle';

type ServiceEditRecordProps = {
  companyId: string;
  businessId: string;
  userId: string;
  serviceId: string;
  record: Service;
  categoryQuery: ServiceCategoriesQuery;
  savePending: boolean;
  onSave: (terms: UpdateServiceInput) => void;
};

// جسم تعديل الخدمة: حالة القفل فوق نموذج التعديل، والاتنين بيبنوا من جديد لما نسخة الخدمة تتغير.
export function ServiceEditRecord(props: ServiceEditRecordProps) {
  return (
    <>
      <ServiceClosingToggle
        companyId={props.companyId}
        businessId={props.businessId}
        userId={props.userId}
        serviceId={props.serviceId}
        record={props.record}
        savePending={props.savePending}
      />
      <EditServiceForm
        key={`${props.record.id}:${props.record.revision}`}
        categoryQuery={props.categoryQuery}
        record={props.record}
        pending={props.savePending}
        onSave={props.onSave}
      />
    </>
  );
}
