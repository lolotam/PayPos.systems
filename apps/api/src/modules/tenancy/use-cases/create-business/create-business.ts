import type { Business, CreateBusinessInput } from '@pospay/contracts';

import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { businessSettings } from '../../domain/business-settings.ts';
import { BUSINESS_CREATED, type BusinessCreated } from '../../events/published.ts';
import type {
  StoredResult,
  TenancyTransactions,
  VerticalTemplates,
} from '../../ports/tenancy-transactions.port.ts';

export interface CreateBusinessCommand {
  readonly companyId: string;
  readonly userId: string;
  readonly input: CreateBusinessInput;
  readonly idempotency: { readonly key: string; readonly fingerprint: string };
}

// Adds a business to the verified company, its settings seeded from the vertical's template (PRD §7.1).
export class CreateBusiness {
  readonly #transactions: TenancyTransactions;
  readonly #templates: VerticalTemplates;
  readonly #ids: IdGenerator;

  constructor(transactions: TenancyTransactions, templates: VerticalTemplates, ids: IdGenerator) {
    this.#transactions = transactions;
    this.#templates = templates;
    this.#ids = ids;
  }

  /**
   * @param command the verified company, the caller, the parsed input and the idempotency key
   * @returns 201 with the business, or the stored response of the first request with this key
   */
  execute(command: CreateBusinessCommand): Promise<StoredResult & { replayed: boolean }> {
    const { companyId, userId, input } = command;
    const context = { companyId, userId, operation: 'create-business' };
    return this.#transactions.run(context, command.idempotency, async (scope) => {
      const business = {
        id: this.#ids.newId(),
        verticalType: input.vertical_type,
        nameEn: input.name_en,
        nameAr: input.name_ar ?? null,
        currency: input.currency,
        timezone: input.timezone,
        settings: businessSettings(
          this.#templates.settingsFor(input.vertical_type),
          input.settings,
        ),
      };
      const { createdAt } = await scope.insertBusiness(business);
      const body: Business = {
        id: business.id,
        company_id: scope.companyId,
        vertical_type: input.vertical_type,
        name_ar: business.nameAr,
        name_en: business.nameEn,
        currency: business.currency,
        timezone: business.timezone,
        settings: business.settings,
        created_at: createdAt,
      };
      await scope.audit.record({
        entity: 'business',
        entityId: business.id,
        action: 'created',
        after: body,
      });
      const payload: BusinessCreated = {
        business_id: business.id,
        company_id: scope.companyId,
        vertical_type: input.vertical_type,
      };
      await scope.outbox.append({
        aggregateType: 'business',
        aggregateId: business.id,
        eventType: BUSINESS_CREATED,
        payload,
      });
      return { status: 201, body };
    });
  }
}
