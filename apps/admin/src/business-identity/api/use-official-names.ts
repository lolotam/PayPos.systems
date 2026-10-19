'use client';

import type { UpdateBusinessIdentityNamesInput } from '@pospay/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isIdentityReadForbidden } from '../model/identity-failure';
import {
  businessIdentityAccessKey,
  mergeBusinessSettings,
  patchIdentityNames,
} from './identity-client';

export function useOfficialNames(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBusinessIdentityNamesInput) =>
      patchIdentityNames(companyId, businessId, body),
    onSuccess: (saved) => mergeBusinessSettings(client, companyId, userId, businessId, saved),
    onError: (error) => {
      if (!isIdentityReadForbidden(error)) return;
      void client.invalidateQueries({
        queryKey: businessIdentityAccessKey(companyId, userId, businessId),
      });
    },
  });
}
