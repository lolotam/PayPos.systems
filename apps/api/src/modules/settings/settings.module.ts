import type { Provider } from '@nestjs/common';
import type { IdGenerator, TenantWrappers, Tx } from '@pospay/db';
import type { Redis } from 'ioredis';

import { SelectedCompanyGuard } from '../../shared/selected-company.guard.ts';
import { SETTINGS_TEMPLATE } from './domain/business-settings.ts';
import { IdentityCapabilityCompanyGuard } from './http/identity-capability-company.guard.ts';
import { IdentityCapabilityController } from './http/identity-capability.controller.ts';
import { SETTINGS_WIRING, SettingsController } from './http/settings.controller.ts';
import { ALERT_RULES_WIRING, AlertRulesController } from './http/alert-rules.controller.ts';
import { createAlertRulesTransactions } from './persistence/alert-rules-store.ts';
import { createAlertRulesReadAccess } from './persistence/alert-rules-read-access.adapter.ts';
import { ResetBranchAlertRule } from './use-cases/reset-branch-alert-rule/reset-branch-alert-rule.ts';
import { SetAlertRules } from './use-cases/set-alert-rules/set-alert-rules.ts';
import { SetAlertsMaster } from './use-cases/set-alerts-master/set-alerts-master.ts';
import { identityCapabilityAccess } from './persistence/business-identity-access.adapter.ts';
import { BUSINESS_IDENTITY_READER } from './queries/business-identity.query.ts';
import { IDENTITY_CAPABILITY_ACCESS } from './queries/identity-capability.query.ts';
import { readBusinessIdentity } from './persistence/read-business-identity.ts';
import { createRedisSettingsCache } from './persistence/redis-settings-cache.ts';
import { createSettingsTransactions } from './persistence/settings-transactions.ts';
import { UpdateBusinessSettings } from './use-cases/update-business-settings/update-business-settings.ts';
import { UpdateBusinessIdentityNames } from './use-cases/update-business-identity-names/update-business-identity-names.ts';
import { SetBusinessLogo } from './use-cases/set-business-logo/set-business-logo.ts';
import { SetBusinessDiscountDefault } from './use-cases/set-business-discount-default/set-business-discount-default.ts';
import {
  resolveEffectiveDiscountLimit,
  type EffectiveDiscountLimit,
} from './domain/effective-discount-limit.ts';
import { readBusinessDiscountDefault } from './queries/business-discount-default.query.ts';
import { createDiscountSubjectReader } from './persistence/discount-subject-reader.adapter.ts';

/** The controllers settings mounts. */
export const settingsControllers = [
  SettingsController,
  IdentityCapabilityController,
  AlertRulesController,
];

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
  return [
    ...settingsWiring(database, ids, redis),
    ...identityCapabilityProviders(database),
    ...businessIdentityProviders(database),
    ...alertRulesProviders(database, ids),
  ];
}

function alertRulesProviders(database: TenantWrappers | undefined, ids: IdGenerator): Provider[] {
  if (database === undefined) return [{ provide: ALERT_RULES_WIRING, useValue: null }];
  const transactions = createAlertRulesTransactions(database, ids);
  return [
    {
      provide: ALERT_RULES_WIRING,
      useValue: {
        branchAccess: createAlertRulesReadAccess(),
        set: new SetAlertRules(transactions),
        reset: new ResetBranchAlertRule(transactions),
        master: new SetAlertsMaster(transactions),
      },
    },
  ];
}

function businessIdentityProviders(database: TenantWrappers | undefined): Provider[] {
  return [
    {
      provide: BUSINESS_IDENTITY_READER,
      useValue: database === undefined ? null : { read: readBusinessIdentity },
    },
  ];
}

function identityCapabilityProviders(database: TenantWrappers | undefined): Provider[] {
  return [
    SelectedCompanyGuard,
    IdentityCapabilityCompanyGuard,
    {
      provide: IDENTITY_CAPABILITY_ACCESS,
      useValue: database === undefined ? null : identityCapabilityAccess(),
    },
  ];
}

function settingsWiring(
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
  const identity = new UpdateBusinessIdentityNames(
    createSettingsTransactions(database, ids),
    cache,
  );
  const logo = new SetBusinessLogo(createSettingsTransactions(database, ids), cache);
  return [
    {
      provide: SETTINGS_WIRING,
      useValue: { update, discount, identity, logo, cache, template: SETTINGS_TEMPLATE },
    },
  ];
}

/**
 * بيعرض الحد الفعلي لمستهلك PR 35 داخل معاملة الشركة نفسها بدون cache.
 * أقفال الشركة ثم العضوية ثم الإعدادات تمنع تجميع قيم الحدين من لحظتين مختلفتين في READ COMMITTED.
 * قارئ العضوية يأخذ وقتًا حاليًا واحدًا بعد الأقفال لفحص أهلية العضوية وصفة المالك.
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
