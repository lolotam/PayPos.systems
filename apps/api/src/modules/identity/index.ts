export {
  Authenticated,
  Require,
  RequiresFeature,
  type AccessTargetParams,
} from './http/access.decorators.ts';
export { ACCESS_READER, AccessGuard, COMPANY_HEADER, FeatureGuard } from './http/access.guard.ts';
export { assertEveryRouteGuarded } from './http/route-coverage.ts';
export { createAccessReader } from './persistence/access-reader.ts';
export type { AccessReader } from './ports/access-reader.port.ts';
