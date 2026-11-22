'use client';
import type { EmployeeDocumentListItem } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Button } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { documentNumberText } from '@/shared/model/document-number-text';
import { DocumentStatusBadge } from './document-status-badge';

export interface DocumentRowActions {
  canManage: boolean;
  opening: boolean;
  onOpen: (objectKey: string) => void;
  onReplace: (typeCode: string) => void;
}

export function documentColumns(
  locale: Locale,
  actions: DocumentRowActions,
): ColumnDef<EmployeeDocumentListItem>[] {
  return [
    {
      id: 'type',
      header: t(locale, 'employeeDocuments.type'),
      cell: ({ row }) =>
        locale === 'ar'
          ? (row.original.type_name_ar ?? row.original.type_name_en)
          : row.original.type_name_en,
    },
    {
      id: 'number',
      header: t(locale, 'employeeDocuments.documentNumber'),
      cell: ({ row }) => {
        const number = documentNumberText(row.original.document_number);
        return number === undefined ? '—' : <bdi>{number}</bdi>;
      },
    },
    {
      id: 'expires',
      header: t(locale, 'employeeDocuments.expiresOn'),
      cell: ({ row }) => row.original.expires_on ?? t(locale, 'employeeDocuments.noExpiry'),
    },
    {
      id: 'status',
      header: t(locale, 'employeeDocuments.statusLabel'),
      cell: ({ row }) => <DocumentStatusBadge status={row.original.status} />,
    },
    {
      id: 'actions',
      header: t(locale, 'employeeDocuments.open'),
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={actions.opening}
            onClick={() => actions.onOpen(row.original.object_key)}
          >
            {t(locale, 'employeeDocuments.open')}
          </Button>
          {actions.canManage ? (
            <Button variant="outline" onClick={() => actions.onReplace(row.original.type_code)}>
              {t(locale, 'employeeDocuments.replace')}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];
}
