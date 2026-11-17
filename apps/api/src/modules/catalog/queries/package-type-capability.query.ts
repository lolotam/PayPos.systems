import type { RequestAuthorizer } from '../../../shared/request-authorizer.ts';

// شاشة قائمة أنواع الباقات في الإدارة تستخدم قرار الصلاحية الحي لإظهار إيقاف البيع واستئنافه.
export async function readPackageTypeManageCapability(
  authorizer: RequestAuthorizer,
  { companyId, businessId, userId }: { companyId: string; businessId: string; userId: string },
): Promise<boolean> {
  return (
    (await authorizer.execute({
      userId,
      requestedCompany: companyId,
      businessParam: businessId,
      permission: 'manage:package-types:business',
    })) !== null
  );
}
