import { PackageRuleError, parseMoney } from '@pospay/domain';
import { PackageSaleError, PackageSalePricingError } from '../../domain/package-sale-errors.ts';
import type { PackageSaleIdentities } from '../../domain/package-sale-plan.ts';
import { planPackageSale } from '../../domain/package-sale-plan.ts';
import {
  assertPackageSaleQuote,
  checkPackageSeller,
  packageSaleTime,
  type PackageSellerFacts,
} from '../../domain/package-sale-rules.ts';
import type {
  PackageSaleClock,
  PackageSaleIds,
  PackageSaleScope,
  PackageSaleTransactions,
} from '../../ports/package-sale.port.ts';

/** إعادة محاولة آمنة لا تحمل نص قاعدة البيانات، وتحفظ سبب الرفض عند تعذر تثبيته. */
export class PackageSaleRetryError extends Error {
  constructor(
    readonly failureCode?: string,
    readonly failureDetails?: unknown,
  ) {
    super('PACKAGE_SALE_RETRY');
    this.name = 'PackageSaleRetryError';
  }
}

/**
 * ينفذ بيع باقة مقبول ذريًا ويثبت الرفض المسمى بعد التراجع دون إعادة تفويض.
 *
 * رفض الفرع غير النشط نهائي ومسمّى `PACKAGE_SALE_BRANCH_INACTIVE`؛ يثبت على صف الطلب ولا يعاد بيعه.
 */
export class ExecutePackageSale {
  constructor(
    private readonly transactions: PackageSaleTransactions,
    private readonly ids: PackageSaleIds,
    private readonly clock: PackageSaleClock,
  ) {}

  /** ينفذ البيع في معاملة واحدة، ثم يثبت الرفض المسمى في معاملة ثانية بعد التراجع. */
  async execute(companyId: string, requestId: string): Promise<void> {
    try {
      await this.transactions.run(companyId, requestId, async (scope) => {
        await this.sell(companyId, scope);
      });
    } catch (error) {
      if (!isNamedRefusal(error)) throw new PackageSaleRetryError();
      const details = 'details' in error ? error.details : undefined;
      try {
        await this.fail(companyId, requestId, error.code, details);
      } catch {
        throw new PackageSaleRetryError(error.code, details);
      }
    }
  }

  async fail(
    companyId: string,
    requestId: string,
    code: string,
    details?: unknown,
  ): Promise<void> {
    await this.transactions.fail(
      companyId,
      requestId,
      code,
      details,
      this.clock.now().toISOString(),
    );
  }

  private async sell(companyId: string, scope: PackageSaleScope): Promise<void> {
    const { request } = scope;
    const type = await scope.lockType();
    await scope.lockSeller(request.seller_employee_id);
    if (type === null) throw new PackageSaleError('PACKAGE_TYPE_NOT_FOUND');
    assertPackageSaleQuote(
      type,
      request.expected_type_revision,
      request.expected_service_revisions,
    );
    const place = await scope.readPlace();
    if (place === null) throw new PackageSaleError('PACKAGE_SALE_BRANCH_INACTIVE');
    const soldAt = request.sold_at === null ? undefined : new Date(request.sold_at);
    const recordedAt = new Date(request.recorded_at);
    const time = packageSaleTime(soldAt, recordedAt, place.timezone);
    if (!(await scope.customerExists(request.customer_id))) {
      throw new PackageSaleError('PACKAGE_CUSTOMER_NOT_FOUND');
    }
    const seller = await scope.readSeller(request.seller_employee_id, time.business_date);
    checkPackageSeller(seller, request.recorded_by);
    const plan = planPackageSale(
      {
        type,
        pricePaid: parseMoney(request.price_paid),
        limitBps: request.discount_limit_bps,
        companyId,
        businessId: request.business_id,
        branchId: request.branch_id,
        customerId: request.customer_id,
        recorderUserId: request.recorded_by,
        recorderMembershipId: request.recorded_by_membership_id,
        seller: seller as PackageSellerFacts,
        paidMethod: request.paid_method,
        soldAt,
        recordedAt,
        timezone: place.timezone,
      },
      packageSaleIdentities(type, this.ids),
    );
    await scope.insert(plan);
    await scope.audit(plan);
    await scope.emit(plan);
    await scope.complete(plan.entitlement.id, this.clock.now().toISOString());
  }
}

function isNamedRefusal(
  error: unknown,
): error is PackageSaleError | PackageSalePricingError | PackageRuleError {
  return (
    error instanceof PackageSaleError ||
    error instanceof PackageSalePricingError ||
    error instanceof PackageRuleError
  );
}

function packageSaleIdentities(
  type: NonNullable<Awaited<ReturnType<PackageSaleScope['lockType']>>>,
  ids: PackageSaleIds,
): PackageSaleIdentities {
  return {
    saleId: ids.newId(),
    components: type.components.map((component) => ({
      serviceId: component.service_id,
      id: ids.newId(),
      slots: Array.from({ length: component.sessions }, (_, index) => ({
        ordinal: index + 1,
        id: ids.newId(),
      })),
    })),
  };
}
