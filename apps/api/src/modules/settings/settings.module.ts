import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

import { SETTINGS_TEMPLATE } from './domain/business-settings.ts';
import { SETTINGS_WIRING, SettingsController } from './http/settings.controller.ts';
import { createRedisSettingsCache } from './persistence/redis-settings-cache.ts';
import { createSettingsTransactions } from './persistence/settings-transactions.ts';
import { UpdateBusinessSettings } from './use-cases/update-business-settings/update-business-settings.ts';

/** The controllers settings mounts. */
export const settingsControllers = [SettingsController];

/**
 * The settings wiring — the one place its ports are bound to their adapters. Without a database or Redis the routes
 * answer NOT_READY after the guards.
 *
 * @param database the tenant wrappers, when the app has a database
 * @param ids      the UUID v7 generator
 * @param redis    the API's Redis client, for the read cache
 * @returns the providers to add to the root module
 */
export function settingsProviders(
  database: TenantWrappers | undefined,
  ids: IdGenerator,
  redis?: Redis,
): Provider[] {
  if (database === undefined || redis === undefined) {
    return [{ provide: SETTINGS_WIRING, useValue: null }];
  }
  const cache = createRedisSettingsCache(redis);
  const update = new UpdateBusinessSettings(
    createSettingsTransactions(database, ids),
    cache,
    SETTINGS_TEMPLATE,
  );
  return [{ provide: SETTINGS_WIRING, useValue: { update, cache, template: SETTINGS_TEMPLATE } }];
}
