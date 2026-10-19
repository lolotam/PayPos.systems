'use client';

import type { BusinessIdentity, UpdateBusinessIdentityNamesInput } from '@pospay/contracts';
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { isIdentityReadForbidden } from '../model/identity-failure';
import {
  businessIdentityAccessKey,
  businessIdentityKey,
  patchIdentityNames,
  refreshBusinessIdentity,
} from './identity-client';

async function savedIdentityNames(
  client: QueryClient,
  companyId: string,
  userId: string,
  businessId: string,
  body: UpdateBusinessIdentityNamesInput,
) {
  const patched = await patchIdentityNames(companyId, businessId, body);
  await refreshBusinessIdentity(client, companyId, userId, businessId, patched);
  const current = client.getQueryData<BusinessIdentity>(
    businessIdentityKey(companyId, userId, businessId),
  );
  if (!current) return patched;
  return {
    official_name_ar: current.official_name_ar,
    official_name_en: current.official_name_en,
  };
}

export function useOfficialNames(companyId: string, userId: string, businessId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBusinessIdentityNamesInput) =>
      savedIdentityNames(client, companyId, userId, businessId, body),
    onError: (error) => {
      if (!isIdentityReadForbidden(error)) return;
      void client.invalidateQueries({
        queryKey: businessIdentityAccessKey(companyId, userId, businessId),
      });
    },
  });
}
