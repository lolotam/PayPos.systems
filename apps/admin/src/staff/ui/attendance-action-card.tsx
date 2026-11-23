'use client';
import { DataTableFrame } from '@pospay/ui';
import type { ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { boardAccessLost } from '../model/attendance-board-display';
import { AttendanceActionFeedback } from './attendance-action-feedback';
import { AttendanceActionPagination } from './attendance-action-pagination';
import { AttendanceActionsTable } from './attendance-actions-table';

type ListQuery = {
  data: unknown;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
  hasNextPage: boolean;
  refetch: () => unknown;
  fetchNextPage: () => unknown;
};

/**
 * كرت قائمة الحضور: التصفية في مكانها الثابت دائمًا، والرسالة والجدول وزر «المزيد» كلها
 * من لقطة واحدة للاستعلام، فلا يبقى زر بجانب رفض ولا صفوف قبل أن تصير الصفحة جاهزة.
 * `listed` تغيب حين لا توجد قائمة أصلًا (لا فرع بمنطقة زمنية في الطلبات): يبقى الكرت بتصفيته فقط؛
 * و`tableReady` تحجب الجدول وحده، فتبقى الرسالة وزر «المزيد» كما كانا (الاستثناءات بلا منطقة زمنية).
 */
export function AttendanceActionCard<T extends { id: string }>({
  filters,
  query,
  listed = true,
  tableReady = true,
  items,
  columns,
}: {
  filters: ReactNode;
  query: ListQuery;
  listed?: boolean;
  tableReady?: boolean;
  items: T[];
  columns: ColumnDef<T>[];
}) {
  const visible = !boardAccessLost(query.error);
  return (
    <DataTableFrame
      stacked
      filters={filters}
      footer={
        listed ? (
          <AttendanceActionPagination
            hasMore={query.hasNextPage && visible}
            fetching={query.isFetching}
            onMore={() => {
              void query.fetchNextPage();
            }}
          />
        ) : undefined
      }
    >
      {listed ? (
        <>
          <div className="p-4 empty:hidden">
            <AttendanceActionFeedback
              error={query.error}
              loading={query.isPending}
              onRetry={() => {
                void query.refetch();
              }}
            />
          </div>
          {tableReady && query.data && visible ? (
            <AttendanceActionsTable items={items} columns={columns} />
          ) : null}
        </>
      ) : null}
    </DataTableFrame>
  );
}
