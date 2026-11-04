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
  const identity = JSON.stringify([
    props.companyId,
    props.businessId,
    props.userId,
    props.employeeId,
  ]);
  const { typeCode, replace } = useReplacementType(identity);
  const { view, record, open, phase } = useEmployeeDocuments(
    props.companyId,
    props.businessId,
    props.userId,
    props.employeeId,
  );
  if (view.isError) return <p role="alert">{envelopeMessage(view.error, locale)}</p>;
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
        onReplace={replace}
      />
      {open.isError ? <p role="alert">{envelopeMessage(open.error, locale)}</p> : null}
      {view.data.can_manage && view.data.types.length > 0 ? (
        <EmployeeDocumentForm
          key={JSON.stringify([
            props.companyId,
            props.businessId,
            props.userId,
            props.employeeId,
            typeCode,
          ])}
          types={view.data.types}
          {...(typeCode === undefined ? {} : { typeCode })}
          pending={record.isPending}
          onSubmit={(submission) => record.mutate(submission)}
        />
      ) : null}
      {progress !== undefined ? <p role="status">{t(locale, progress)}</p> : null}
      {record.isError ? <p role="alert">{envelopeMessage(record.error, locale)}</p> : null}
      {record.isSuccess && record.data !== undefined ? (
        <p role="status">{t(locale, 'employeeDocuments.recorded')}</p>
      ) : null}
    </section>
  );
}

function useReplacementType(identity: string) {
  const [replacement, setReplacement] = useState<{ identity: string; typeCode?: string }>({
    identity,
  });
  if (replacement.identity !== identity) setReplacement({ identity });
  return {
    typeCode: replacement.identity === identity ? replacement.typeCode : undefined,
    replace: (typeCode: string) => setReplacement({ identity, typeCode }),
  };
}
