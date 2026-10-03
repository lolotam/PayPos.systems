import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import type { Redis } from 'ioredis';

import { SETTINGS_TEMPLATE } from './domain/business-settings.ts';
import { SETTINGS_WIRING, SettingsController } from './http/settings.controller.ts';
import { createRedisSettingsCache } from './persistence/redis-settings-cache.ts';
import { createSettingsTransactions } from './persistence/settings-transactions.ts';
import { UpdateBusinessSettings } from './use-cases/update-business-settings/update-business-settings.ts';
import { SetBusinessDiscountDefault } from './use-cases/set-business-discount-default/set-business-discount-default.ts';
import {
  resolveEffectiveDiscountLimit,
  type EffectiveDiscountLimit,
} from './domain/effective-discount-limit.ts';
import { readBusinessDiscountDefault } from './queries/business-discount-default.query.ts';
import { createDiscountSubjectReader } from './persistence/discount-subject-reader.adapter.ts';

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
  const cache = createRedisSettingsCache(redis, ids);
  const update = new UpdateBusinessSettings(
    createSettingsTransactions(database, ids),
    cache,
    SETTINGS_TEMPLATE,
  );
  const discount = new SetBusinessDiscountDefault(createSettingsTransactions(database, ids), cache);
  return [
    {
      provide: SETTINGS_WIRING,
      useValue: { update, discount, cache, template: SETTINGS_TEMPLATE },
    },
  ];
}

/**
 * بيعرض الحد الفعلي لمستهلك PR 35 داخل معاملة الشركة نفسها بدون cache.
 * أقفال الشركة ثم العضوية ثم الإعدادات تمنع تجميع قيم الحدين من لحظتين مختلفتين في READ COMMITTED.
 *
 * @param tx معاملة المستهلك المؤكدة
 * @param companyId الشركة المؤكدة
 * @param businessId نشاط الخدمة
 * @param membershipId عضوية الشخص
 * @returns حد الشخص ثم النشاط، أو حالة المالك/عدم الإعداد/عدم توفر العضوية
 */
export async function readEffectiveDiscountLimit(
  tx: Tx,
  companyId: string,
  businessId: string,
  membershipId: string,
): Promise<EffectiveDiscountLimit> {
  const reader = createDiscountSubjectReader(tx, companyId);
  if (!(await reader.lock(membershipId))) return { status: 'MEMBERSHIP_NOT_FOUND' };
  const businessDefault = await readBusinessDiscountDefault(tx, companyId, businessId);
  const subject = await reader.read(membershipId, businessId);
  return resolveEffectiveDiscountLimit(subject, businessDefault);
}
