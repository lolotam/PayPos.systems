import type { Company, CreateCompanyInput } from '@pospay/contracts';

import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { COMPANY_CREATED, type CompanyCreated } from '../../events/published.ts';
import type { CompanyRegistry } from '../../ports/company-registry.port.ts';
import type { OnboardingTransactions, StoredResult } from '../../ports/onboarding.port.ts';

export interface OnboardCompanyCommand {
  /** The caller, from the verified session — the company's first owner. */
  readonly userId: string;
  readonly input: CreateCompanyInput;
  readonly idempotency: { readonly key: string; readonly fingerprint: string };
}

/** The requested plan does not exist; nothing was written and the key was not claimed. */
export class UnknownPlanError extends Error {
  override readonly name = 'UnknownPlanError';
}

// Creates a company with its first owner (ADR-0003 §5.3): company, owner membership, audit row and CompanyCreated,
// all in one transaction, once per Idempotency-Key in the caller's USER scope.
export class OnboardCompany {
  readonly #transactions: OnboardingTransactions;
  readonly #registry: CompanyRegistry;
  readonly #ids: IdGenerator;

  constructor(transactions: OnboardingTransactions, registry: CompanyRegistry, ids: IdGenerator) {
    this.#transactions = transactions;
    this.#registry = registry;
    this.#ids = ids;
  }

  /**
   * @param command the caller, the validated input and the request's idempotency key
   * @returns 201 with the company, or the stored response of the first request with this key
   */
  execute(command: OnboardCompanyCommand): Promise<StoredResult & { replayed: boolean }> {
    const { userId, input } = command;
    return this.#transactions.run(userId, command.idempotency, async (scope) => {
      if (!(await scope.planExists(input.plan_id))) throw new UnknownPlanError();
      const company = {
        id: scope.companyId,
        nameEn: input.name_en,
        nameAr: input.name_ar ?? null,
        ownerUserId: userId,
        planId: input.plan_id,
      };
      const { createdAt } = await this.#registry.register(scope.tx, company);
      await scope.addOwnerMembership(this.#ids.newId(), userId);
      const body: Company = {
        id: company.id,
        name_ar: company.nameAr,
        name_en: company.nameEn,
        owner_user_id: userId,
        plan_id: company.planId,
        created_at: createdAt.toISOString(),
        deleted_at: null,
      };
      await scope.audit.record({
        entity: 'company',
        entityId: company.id,
        action: 'created',
        after: body,
      });
      const payload: CompanyCreated = {
        company_id: company.id,
        owner_user_id: userId,
        plan_id: company.planId,
      };
      await scope.outbox.append({
        aggregateType: 'company',
        aggregateId: company.id,
        eventType: COMPANY_CREATED,
        payload,
      });
      return { status: 201, body };
    });
  }
}
