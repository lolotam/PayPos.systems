import type { IdGenerator, TenantWrappers } from '@pospay/db';
import { createInAppNotificationModule } from '../../modules/notifications/index.ts';

export function createInAppTestModule(database: Pick<TenantWrappers, 'withTenant'>, ids: IdGenerator, clock: { now(): Date }) {
  return createInAppNotificationModule({ database, ids, clock });
}
