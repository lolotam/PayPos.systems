'use client';

import type { CommissionBlockedCorrection } from '@pospay/contracts';
import { getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useLocale } from '@/shared/locale/locale-context';
import { blockedCorrectionColumns } from './blocked-corrections-columns';
import { StackedCommissionTable } from './stacked-commission-table';

interface BlockedCorrectionsTableProps {
  items: readonly CommissionBlockedCorrection[];
  timeZone: string;
  employeeLabel(employeeId: string): string;
  onRepair(item: CommissionBlockedCorrection): void;
}

/** جدول التصحيحات الموقوفة بصفوفه الجاهزة؛ الإطار والفلتر وزرار التحميل بيتولّاهم القسم اللي حواليه. */
export function BlockedCorrectionsTable({
  items,
  timeZone,
  employeeLabel,
  onRepair,
}: BlockedCorrectionsTableProps) {
  const locale = useLocale();
  const data = useMemo(() => [...items], [items]);
  // هوية الأعمدة الثابتة شرط في TanStack Table: مصفوفة جديدة كل رسم بتتعامل كتغيير نموذج.
  const columns = useMemo(
    () => blockedCorrectionColumns({ locale, timeZone, employeeLabel, onRepair }),
    [locale, timeZone, employeeLabel, onRepair],
  );
  const table = useReactTable({
    data,
    columns,
    getRowId: (row) => row.id,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
  });
  return <StackedCommissionTable table={table} />;
}
