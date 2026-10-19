'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { businessIdentityAccessKey } from './identity-client';

// رفض القراءة بعد ما الصلاحية اتأكدت معناه إنها اتسحبت؛ إعادة فحصها بتقفل الشاشة كلها مش الأسماء بس.
export function useRecheckIdentityAccess(
  refused: boolean,
  companyId: string,
  userId: string,
  businessId: string,
) {
  const client = useQueryClient();
  useEffect(() => {
    if (!refused) return;
    void client.invalidateQueries({
      queryKey: businessIdentityAccessKey(companyId, userId, businessId),
    });
  }, [client, refused, companyId, userId, businessId]);
}
