export {
  Authenticated,
  Require,
  RequirePlatform,
  RequiresFeature,
  type AccessTargetParams,
} from './http/access.decorators.ts';
export { COMPANY_HEADER } from './http/access.guard.ts';
export { assertEveryRouteGuarded } from './http/route-coverage.ts';
export { identityProviders } from './identity.module.ts';
