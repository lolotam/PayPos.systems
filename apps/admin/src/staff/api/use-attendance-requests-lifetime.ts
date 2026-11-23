'use client';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { attendanceActionKey } from './use-attendance-actions-read';
import type { AttendanceBoardScope } from './use-attendance-board';

/**
 * قائمة الطلبات كانت تعيش مع وجود منطقة زمنية للفرع فقط: لما تغيب تُفكّ القائمة بمحرّر القرار
 * المفتوح وكاش طلباتها، ولما ترجع تبدأ من قراءة جديدة. الكرت صار ثابتًا بتصفيته، فنربط عمر
 * هذه الأشياء الثلاثة بحضور المنطقة الزمنية هنا بنفس اللحظة: تفريغ الاختيار ومسح الكاش.
 */
export function useAttendanceRequestsLifetime(
  scope: AttendanceBoardScope,
  present: boolean,
  onEnd: () => void,
) {
  const client = useQueryClient();
  const { companyId, businessId, branchId, userId } = scope;
  useEffect(() => {
    if (!present) return;
    return () => {
      onEnd();
      client.removeQueries({
        queryKey: [...attendanceActionKey({ companyId, businessId, branchId, userId }), 'requests'],
      });
    };
  }, [client, present, onEnd, companyId, businessId, branchId, userId]);
}
