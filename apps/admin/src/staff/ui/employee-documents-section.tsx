'use client';
import { t, type MessageKey } from '@pospay/i18n';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeDocuments } from '../api/use-employee-documents';
import { EmployeeDocumentForm } from './employee-document-form';
import { EmployeeDocumentsTable } from './employee-documents-table';

const PHASES: Record<string, MessageKey | undefined> = {
  uploading: 'employeeDocuments.uploading',
  verifying: 'employeeDocuments.verifying',
  recording: 'employeeDocuments.uploading',
};

export function EmployeeDocumentsSection(props: {
  companyId: string;
  businessId: string;
  userId: string;
  employeeId: string;
}) {
  const locale = useLocale();
  const [typeCode, setTypeCode] = useState<string>();
  const { view, record, open, phase } = useEmployeeDocuments(
    props.companyId,
    props.businessId,
    props.userId,
    props.employeeId,
  );
  // بيانات cache لا تثبت الصلاحية لهذا الفتح؛ ننتظر قراءة ناجحة بعد تركيب القسم.
  if (!view.isFetchedAfterMount || !view.data || view.isError) return null;
  const progress = PHASES[phase];
  return (
    <section aria-label={t(locale, 'employeeDocuments.title')} className="flex flex-col gap-4">
      <h3 className="font-bold">{t(locale, 'employeeDocuments.title')}</h3>
      <p>{t(locale, 'employeeDocuments.lead')}</p>
      {view.data.items.length === 0 ? <p>{t(locale, 'employeeDocuments.empty')}</p> : null}
      <EmployeeDocumentsTable
        items={view.data.items}
        canManage={view.data.can_manage}
        opening={open.isPending}
        onOpen={(key) => open.mutate(key)}
        onReplace={setTypeCode}
      />
      {open.isError ? <p role="alert">{envelopeMessage(open.error, locale)}</p> : null}
      {view.data.can_manage && view.data.types.length > 0 ? (
        <EmployeeDocumentForm
          key={typeCode ?? ''}
          types={view.data.types}
          {...(typeCode === undefined ? {} : { typeCode })}
          pending={record.isPending}
          onSubmit={(submission) => record.mutate(submission)}
        />
      ) : null}
      {progress !== undefined ? <p role="status">{t(locale, progress)}</p> : null}
      {record.isError ? <p role="alert">{envelopeMessage(record.error, locale)}</p> : null}
      {record.isSuccess ? <p role="status">{t(locale, 'employeeDocuments.recorded')}</p> : null}
    </section>
  );
}
