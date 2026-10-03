export { COMPANY_HEADER } from './http/access.guard.ts';
export {
  lockBusinessDiscountAccess,
  readBusinessDiscountAccess,
} from './persistence/business-discount-access.ts';
export { lockMembershipDiscountSubject } from './persistence/membership-discount-read-lock.ts';
export { lockEmployeeCreationAccess } from './persistence/employee-creation-access.ts';
export {
  employeeUserLinkAvailable,
  readEmployeeDetailAccess,
} from './persistence/employee-scope-access.ts';
export { assertEveryRouteGuarded } from './http/route-coverage.ts';
export { identityControllers, identityProviders, staffOtpDependencies } from './identity.module.ts';
export { readEmployeeBranchAccess } from './persistence/employee-scope-access.ts';
export {
  readMembershipDiscountLimit,
  readMembershipDiscountSubject,
  type MembershipDiscountSubject,
  type MembershipDiscountLimitResult,
} from './queries/membership-discount-limit.query.ts';
export {
  effectiveDiscountBps,
  isWithinLimit,
  validateDiscountLimitBps,
} from './domain/discount-limit.ts';
