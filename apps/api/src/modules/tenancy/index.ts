export {
  registerCompany,
  type RegisterCompanyInput,
  type RegisteredCompany,
} from './persistence/register-company.ts';
export { describeWorkspaces, type WorkspaceScope } from './queries/describe-workspaces.query.ts';
export { tenancyControllers, tenancyProviders } from './tenancy.module.ts';
export { employeeWorkplace } from './queries/employee-workplace.query.ts';
export { businessDiscountScope } from './queries/business-discount-scope.query.ts';
