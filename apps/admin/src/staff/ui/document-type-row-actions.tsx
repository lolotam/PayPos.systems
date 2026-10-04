'use client';
import type { DocumentType } from '@pospay/contracts';
import { t } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import { useLocale } from '@/shared/locale/locale-context';

export interface DocumentTypeActions {
  pending: boolean;
  onEdit: (type: DocumentType) => void;
  onToggle: (type: DocumentType) => void;
}

export function DocumentTypeRowActions({
  type,
  actions,
}: {
  type: DocumentType;
  actions: DocumentTypeActions;
}) {
  const locale = useLocale();
  return (
    <div className="flex gap-2">
      <Button variant="outline" disabled={actions.pending} onClick={() => actions.onEdit(type)}>
        {t(locale, 'employeeDocuments.edit')}
      </Button>
      <Button variant="outline" disabled={actions.pending} onClick={() => actions.onToggle(type)}>
        {t(locale, type.active ? 'employeeDocuments.deactivate' : 'employeeDocuments.reactivate')}
      </Button>
    </div>
  );
}
