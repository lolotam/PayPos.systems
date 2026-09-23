import type { Branch, CreateBranchInput } from '@pospay/contracts';

import type { IdGenerator } from '../../../../shared/ports/id-generator.port.ts';
import { effectiveTimeZone } from '../../domain/time-zone.ts';
import { BRANCH_CREATED, type BranchCreated } from '../../events/published.ts';
import type { StoredResult, TenancyTransactions } from '../../ports/tenancy-transactions.port.ts';

export interface CreateBranchCommand {
  readonly companyId: string;
  readonly userId: string;
  /** Already verified by the access guard to belong to companyId. */
  readonly businessId: string;
  readonly input: CreateBranchInput;
  readonly idempotency: { readonly key: string; readonly fingerprint: string };
}

// Adds an active branch to one business of the verified company.
export class CreateBranch {
  readonly #transactions: TenancyTransactions;
  readonly #ids: IdGenerator;

  constructor(transactions: TenancyTransactions, ids: IdGenerator) {
    this.#transactions = transactions;
    this.#ids = ids;
  }

  /**
   * @param command the verified company and business, the caller, the parsed input and the idempotency key
   * @returns 201 with the branch, or the stored response of the first request with this key
   */
  execute(command: CreateBranchCommand): Promise<StoredResult & { replayed: boolean }> {
    const { companyId, userId, businessId, input } = command;
    const context = { companyId, userId, operation: 'create-branch' };
    return this.#transactions.run(context, command.idempotency, async (scope) => {
      const branch = {
        id: this.#ids.newId(),
        businessId,
        nameEn: input.name_en,
        nameAr: input.name_ar ?? null,
        addressAr: input.address_ar ?? null,
        addressEn: input.address_en ?? null,
        geo: input.geo ?? null,
        openingHours: input.opening_hours ?? null,
        timeZone: input.timezone ?? null,
      };
      const { createdAt, businessTimeZone } = await scope.insertBranch(branch);
      const body: Branch = {
        id: branch.id,
        company_id: scope.companyId,
        business_id: businessId,
        name_ar: branch.nameAr,
        name_en: branch.nameEn,
        address_ar: branch.addressAr,
        address_en: branch.addressEn,
        geo: branch.geo,
        opening_hours: input.opening_hours ?? null,
        timezone: branch.timeZone,
        effective_timezone: effectiveTimeZone(branch.timeZone, businessTimeZone),
        is_active: true,
        created_at: createdAt,
      };
      await scope.audit.record({
        entity: 'branch',
        entityId: branch.id,
        action: 'created',
        after: body,
      });
      const payload: BranchCreated = {
        branch_id: branch.id,
        business_id: businessId,
        company_id: scope.companyId,
      };
      await scope.outbox.append({
        aggregateType: 'branch',
        aggregateId: branch.id,
        eventType: BRANCH_CREATED,
        payload,
      });
      return { status: 201, body };
    });
  }
}
