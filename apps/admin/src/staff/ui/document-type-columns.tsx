'use client';
import type { DocumentType } from '@pospay/contracts';
import { t, type Locale } from '@pospay/i18n';
import { Badge } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import { DocumentTypeRowActions, type DocumentTypeActions } from './document-type-row-actions';

export function documentTypeColumns(
  locale: Locale,
  actions: DocumentTypeActions,
): ColumnDef<DocumentType>[] {
  return [
    {
      id: 'name',
      header: t(locale, 'employeeDocuments.type'),
      cell: ({ row }) =>
        locale === 'ar' ? (row.original.name_ar ?? row.original.name_en) : row.original.name_en,
    },
    { accessorKey: 'alert_days', header: t(locale, 'employeeDocuments.alertDays') },
    {
      id: 'expiry',
      header: t(locale, 'employeeDocuments.requiresExpiry'),
      cell: ({ row }) =>
        t(
          locale,
          row.original.requires_expiry
            ? 'employeeDocuments.expiryRequired'
            : 'employeeDocuments.expiryOptional',
        ),
    },
    {
      id: 'state',
      header: t(locale, 'employeeDocuments.activeLabel'),
      cell: ({ row }) => (
        <Badge variant={row.original.active ? 'success' : 'neutral'}>
          {t(
            locale,
            row.original.active ? 'employeeDocuments.active' : 'employeeDocuments.inactive',
          )}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: t(locale, 'employeeDocuments.edit'),
      cell: ({ row }) => <DocumentTypeRowActions type={row.original} actions={actions} />,
    },
  ];
}
