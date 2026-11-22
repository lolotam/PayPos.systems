'use client';

import { useBusinessIdentity } from '../api/use-business-identity';
import { useOfficialNames } from '../api/use-official-names';
import { useRecheckIdentityAccess } from '../api/use-recheck-identity-access';
import { isAuthorizationRefusal } from '../model/identity-failure';
import { IdentityColumns } from './identity-columns';

type Scope = { companyId: string; userId: string; businessId: string };

export function BusinessIdentityPage(scope: Scope) {
  const identity = useBusinessIdentity(scope.companyId, scope.userId, scope.businessId);
  const names = useOfficialNames(scope.companyId, scope.userId, scope.businessId);
  const refused = isAuthorizationRefusal(identity.error);
  useRecheckIdentityAccess(refused, scope.companyId, scope.userId, scope.businessId);
  return <IdentityColumns scope={scope} identity={identity} names={names} />;
}
