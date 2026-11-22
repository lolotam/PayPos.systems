'use client';
import { t, type MessageKey } from '@pospay/i18n';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useEmployeeDocuments } from '../api/use-employee-documents';
import { EmployeeDocumentForm } from './employee-document-form';
import { EmployeeDocumentsTable } from './employee-documents-table';

type UploadDraft = {
  identity: string;
  saved: object | undefined;
  number: string;
  typeCode?: string;
  revision: number;
};

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
  const { view, documents, record, open, phase } = useEmployeeDocuments(
    props.companyId,
    props.businessId,
    props.userId,
    props.employeeId,
  );
  const draft = useUploadDraft(JSON.stringify([identity, typeCode]), view, record);
  if (view.isError) return <p role="alert">{envelopeMessage(view.error, locale)}</p>;
  // العرض والفتح يشتركان في دليل قراءة حقيقية للعمر والـquery الحالية، مش بيانات cache وحدها.
  if (!documents) return null;
  const retryType = documents.types.find((type) => type.code === draft.typeCode)?.code;
  const formType = retryType ?? typeCode;
  const progress = PHASES[phase];
  const recorded = record.isSuccess && record.data !== undefined;
  return (
    <section aria-label={t(locale, 'employeeDocuments.title')} className="flex flex-col gap-4">
      <h3 className="font-bold">{t(locale, 'employeeDocuments.title')}</h3>
      <p>{t(locale, 'employeeDocuments.lead')}</p>
      {documents.items.length === 0 ? <p>{t(locale, 'employeeDocuments.empty')}</p> : null}
      <EmployeeDocumentsTable
        items={documents.items}
        canManage={documents.can_manage}
        opening={open.isPending}
        onOpen={(key) => open.mutate(key)}
        onReplace={replace}
      />
      {open.isError ? <p role="alert">{envelopeMessage(open.error, locale)}</p> : null}
      {documents.can_manage && documents.types.length > 0 ? (
        <EmployeeDocumentForm
          key={draft.revision}
          types={documents.types}
          {...(formType === undefined ? {} : { typeCode: formType })}
          pending={record.isPending}
          initialNumber={retryType === undefined ? '' : draft.number}
          discardRetryFor={draft.discardRetryFor}
          onSubmit={draft.submit}
        />
      ) : null}
      {progress !== undefined ? <p role="status">{t(locale, progress)}</p> : null}
      {record.isError ? <p role="alert">{envelopeMessage(record.error, locale)}</p> : null}
      {recorded ? <p role="status">{t(locale, 'employeeDocuments.recorded')}</p> : null}
    </section>
  );
}

function useUploadDraft(
  identity: string,
  view: ReturnType<typeof useEmployeeDocuments>['view'],
  record: ReturnType<typeof useEmployeeDocuments>['record'],
) {
  const [draft, setDraft] = useState<UploadDraft>({
    identity,
    saved: undefined,
    number: '',
    revision: 0,
  });
  const status = (view.error as { status?: number } | null)?.status;
  const uploadError = (record.error as { code?: unknown } | null)?.code;
  const denied =
    status === 401 ||
    status === 403 ||
    status === 404 ||
    view.data?.can_manage === false ||
    uploadError === 'UNAUTHENTICATED' ||
    uploadError === 'FORBIDDEN' ||
    uploadError === 'NOT_FOUND' ||
    uploadError === 'FEATURE_DISABLED';
  const saved = record.recordedTicket;
  const reset =
    draft.identity !== identity ||
    (draft.typeCode !== undefined && denied) ||
    (saved !== undefined && saved !== draft.saved);
  // الخطأ العابر يخفي النموذج، مع إبقاء الرقم المحلي للمحاولة بعد قراءة مصرح بها.
  const current: UploadDraft = reset
    ? { identity, number: '', revision: draft.revision + 1, saved }
    : draft;
  if (reset) setDraft(current);
  return {
    number: current.number,
    typeCode: current.typeCode,
    revision: current.revision,
    discardRetryFor: (selectedType: string) => {
      if (current.typeCode === undefined || current.typeCode === selectedType) return false;
      setDraft({ identity, saved: current.saved, revision: current.revision, number: '' });
      return true;
    },
    submit: (submission: Parameters<typeof record.mutate>[0]) => {
      const { type_code, document_number } = submission.values;
      setDraft({ ...current, typeCode: type_code, number: document_number ?? '' });
      record.mutate(submission);
    },
  };
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
