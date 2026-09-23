export {
  OWNER_ROLE_ID,
  PERMISSIONS,
  PLATFORM_ROLES,
  SYSTEM_ROLES,
  type Permission,
  type PlatformPermission,
  type TenantPermission,
  type SystemRole,
} from './access-catalog.ts';
export {
  createAuthDatabase,
  type AuthDatabase,
  type IdentitySchema,
  type PlatformAuditEntry,
} from './auth-database.ts';
export { appendAuditLog, type AuditEntry } from './audit-log.ts';
export { createDatabase, type Database, type DatabaseOptions } from './client.ts';
export { markEventConsumed } from './consumed-events.ts';
export {
  createOutboxDispatcherDatabase,
  type ClaimedEvent,
  type DeliveryOutcome,
  type DispatchOptions,
  type OutboxDispatcherDatabase,
} from './dispatcher.ts';
export {
  IdempotencyKeyBusyError,
  IdempotencyKeyReusedError,
  runIdempotent,
  type IdempotencyRequest,
  type IdempotentResult,
  type StoredResponse,
} from './idempotency.ts';
export { appendOutboxEvent, type OutboxEvent } from './outbox.ts';
export type { IdGenerator, TenantOptions, TenantWrappers, Tx } from './with-tenant.ts';
export { FEATURE_FLAGS, PROVISIONAL_PLAN_ID, type FeatureFlag } from './seed.ts';
export { verticalTemplate, type VerticalTemplate } from './vertical-templates.ts';
export {
  grantPlatformPermission,
  revokePlatformPermission,
  type PlatformGrantOutcome,
  type PlatformGrantRequest,
} from './platform-grants.ts';
