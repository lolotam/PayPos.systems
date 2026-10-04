'use client';
import type { CreateDocumentTypeInput, DocumentType } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Card, EmptyState, CircleAlert, LoaderCircle } from '@pospay/ui';
import { useState } from 'react';
import { envelopeMessage } from '@/shared/api/api-error';
import { useLocale } from '@/shared/locale/locale-context';
import { useDocumentTypes } from '../api/use-document-types';
import { DocumentTypeForm } from './document-type-form';
import { DocumentTypesTable } from './document-types-table';

export function DocumentTypesPanel({ companyId, userId }: { companyId: string; userId: string }) {
  const locale = useLocale();
  const [editing, setEditing] = useState<DocumentType>();
  const { list, change } = useDocumentTypes(companyId, userId);
  if (list.isPending)
    return <EmptyState icon={<LoaderCircle />} role="status" title={t(locale, 'admin.loading')} />;
  if (list.isError)
    return (
      <EmptyState
        icon={<CircleAlert />}
        role="alert"
        tone="danger"
        title={t(locale, 'employeeDocuments.typesUnavailable')}
      />
    );
  const save = (input: CreateDocumentTypeInput) =>
    change.mutate(editing ? { kind: 'update', type: editing, input } : { kind: 'create', input }, {
      onSuccess: () => setEditing(undefined),
    });
  return (
    <Card className="flex flex-col gap-4 p-6">
      <DocumentTypesTable
        items={list.data.items}
        pending={change.isPending}
        onEdit={setEditing}
        onToggle={(type) =>
          change.mutate({ kind: type.active ? 'deactivate' : 'reactivate', type })
        }
      />
      <DocumentTypeForm
        key={editing ? `${editing.id}:${editing.revision}` : 'new'}
        {...(editing === undefined ? {} : { type: editing, onCancel: () => setEditing(undefined) })}
        pending={change.isPending}
        onSave={save}
      />
      {change.isError ? <p role="alert">{envelopeMessage(change.error, locale)}</p> : null}
      {change.isSuccess ? <p role="status">{t(locale, 'employeeDocuments.saved')}</p> : null}
    </Card>
  );
}
