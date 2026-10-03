import type { RequestAuthorizer } from '../../../shared/request-authorizer.ts';
import type { FilePermissions } from '../ports/files.port.ts';

export function filePermissions(authorizer: RequestAuthorizer): FilePermissions {
  return {
    allowed: async (actor, permission, businessId, branchId) =>
      (await authorizer.execute({
        userId: actor.userId,
        requestedCompany: actor.companyId,
        permission,
        ...(permission.endsWith(':branch')
          ? { branchParam: branchId }
          : permission.endsWith(':business')
            ? { businessParam: businessId }
            : {}),
      })) !== null,
  };
}
