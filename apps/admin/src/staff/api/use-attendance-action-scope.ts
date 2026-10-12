'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AttendanceBoardScope } from './use-attendance-board';
export function useAttendanceActionScope(scope: AttendanceBoardScope, resource: string) {
  const client = useQueryClient();
  const { companyId, businessId, branchId, userId } = scope;
  useEffect(
    () => () => {
      client.removeQueries({
        queryKey: ['attendance-actions', companyId, businessId, branchId, userId, resource],
      });
    },
    [client, companyId, businessId, branchId, userId, resource],
  );
}
