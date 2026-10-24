'use client';

import { useIsMutating } from '@tanstack/react-query';
import { alertRulesWriteKey } from './alert-rules-client';

export function useAlertRulesWriting(
  companyId: string,
  userId: string,
  businessId: string,
): boolean {
  return useIsMutating({ mutationKey: alertRulesWriteKey(companyId, userId, businessId) }) > 0;
}
