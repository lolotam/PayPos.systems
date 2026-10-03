import { validateScheduleWeek } from '../domain/schedule-calendar.ts';
import { schedulingAccess, schedulingContext } from './schedule-context.adapter.ts';

import type { Tx } from '@pospay/db';
export function createScheduleReadAccess() {
  return {
    read: async (
      tx: Tx,
      companyId: string,
      userId: string,
      businessId: string,
      branchId: string | null,
      week?: string,
    ) => {
      const context = await schedulingContext(tx, companyId, businessId, branchId);
      if (!context) return 'NOT_FOUND' as const;
      const decision = await schedulingAccess(tx, companyId, userId, businessId, branchId, 'read');
      if (decision === 'DENIED') return 'FORBIDDEN' as const;
      if (decision === 'FEATURE_DISABLED') return decision;
      if (week !== undefined) {
        try {
          validateScheduleWeek(week);
        } catch {
          return 'SCHEDULE_WEEK_INVALID' as const;
        }
      }
      return context;
    },
  };
}
