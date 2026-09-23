import type { BusinessSettings } from '@pospay/contracts';

import { effectiveSettings, type SettingsTemplateValues } from '../../domain/business-settings.ts';
import type {
  SettingsCache,
  SettingsChange,
  SettingsTransactions,
  StoredSettings,
} from '../../ports/settings.port.ts';

const overridesOf = (row: StoredSettings | null) => ({
  default_language: row?.defaultLanguage ?? null,
  calendar: row?.calendar ?? null,
});

// A manager changes a business's settings, or returns a value to the template; the change is audited, and the cached
// read is dropped once the transaction has committed.
export class UpdateBusinessSettings {
  readonly #transactions: SettingsTransactions;
  readonly #cache: SettingsCache;
  readonly #template: SettingsTemplateValues;

  constructor(
    transactions: SettingsTransactions,
    cache: SettingsCache,
    template: SettingsTemplateValues,
  ) {
    this.#transactions = transactions;
    this.#cache = cache;
    this.#template = template;
  }

  /**
   * @param command the verified company and business, the manager and the change
   * @param command.companyId  the verified company
   * @param command.userId     the manager
   * @param command.businessId the business the guard authorized
   * @param command.change     the keys to set, or null to return to the template
   * @returns the business's effective settings after the change
   */
  async execute(command: {
    companyId: string;
    userId: string;
    businessId: string;
    change: SettingsChange;
  }): Promise<BusinessSettings> {
    const { companyId, userId, businessId } = command;
    const saved = await this.#transactions.run(companyId, userId, async (scope) => {
      const before = await scope.findForUpdate(businessId);
      const after = await scope.save(businessId, command.change, userId);
      await scope.audit.record({
        entity: 'business_settings',
        entityId: businessId,
        action: 'settings.changed',
        before: overridesOf(before),
        after: overridesOf(after),
      });
      return after;
    });
    await this.#cache.invalidate(companyId, businessId);
    const effective = effectiveSettings(this.#template, saved);
    return {
      business_id: businessId,
      default_language: effective.defaultLanguage,
      calendar: effective.calendar,
      tax_rule: (saved.taxRule ?? null) as BusinessSettings['tax_rule'],
      overridden: [...effective.overridden],
      updated_at: saved.updatedAt,
    };
  }
}
