import type { SellPackageInput, SellPackageResponse } from '@pospay/contracts';
import { parseMoney } from '@pospay/domain';

import { PackageSaleError } from '../../domain/errors.ts';
import { planPackageSale, type PackageSaleIdentities } from '../../domain/package-sale-plan.ts';
import { assertPackageSaleQuote, checkPackageSeller, packageSaleTime } from '../../domain/package-sale-rules.ts';
import { saleResponse } from '../../domain/package-sale-response.ts';
import type { SalePackageType } from '../../domain/package-sale-types.ts';
import { resolveSessionRecorder } from '../../domain/session-authority.ts';
import { SessionError } from '../../domain/session-error.ts';
import type { Clock, IdGenerator } from '../../ports/service-session-transactions.port.ts';
import type {
  PackageSaleContext,
  PackageSaleTransaction,
  PackageSaleTransactions,
} from '../../ports/package-sale-transactions.port.ts';

export { PackageRuleError, PackageSaleError, PackageSalePricingError } from '../../domain/errors.ts';

/** يبيع باقة واحدة في معاملة واحدة؛ الاستحقاق والمكوّنات والجلسات والتدقيق والحدث بيتموا مع بعض. */
export class SellPackageUseCase {
  constructor(
    private readonly transactions: PackageSaleTransactions,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * يبيع الباقة المطلوبة ويضمن أن كل رفض قبل أي كتابة يرجع المعاملة كلها.
   *
   * @param context شركة وكاتب ونطاق البيع ومفتاح الطلب وبصمته من النقل
   * @param input جسم الطلب المتحقّق من العقد
   * @returns رد بيع الباقة المحفوظ
   */
  async execute(
    context: PackageSaleContext,
    input: SellPackageInput,
  ): Promise<SellPackageResponse> {
    return this.transactions.run(context, async (tx) => {
      const place = await tx.place.read();
      if (place === null) throw new SessionError('FORBIDDEN');
      resolveSessionRecorder(
        await tx.access.read(this.clock.now()),
        input.recorder_membership_id,
        undefined,
        context.userId,
      );
      const response = await tx.idempotent('sell-package', () => this.sell(tx, context, input));
      if (response.replayed) {
        resolveSessionRecorder(
          await tx.access.read(this.clock.now()),
          input.recorder_membership_id,
          undefined,
          context.userId,
        );
      }
      return response.body;
    });
  }

  /** خطوات البيع بعد حجز المفتاح؛ كل قراءة بعد قفلها، وكل كتابة في نفس المعاملة. */
  private async sell(
    tx: PackageSaleTransaction,
    context: PackageSaleContext,
    input: SellPackageInput,
  ): Promise<SellPackageResponse> {
    await tx.access.lock();
    const type = await tx.catalog.readPackageTypeForSale(input.package_type_id);
    await tx.performers.lock([input.seller_employee_id]);
    const at = this.clock.now();
    const membershipId = resolveSessionRecorder(
      await tx.access.read(at),
      input.recorder_membership_id,
      undefined,
      context.userId,
    );
    if (type === null) throw new PackageSaleError('PACKAGE_TYPE_NOT_FOUND');
    assertPackageSaleQuote(type, input.expected_type_revision, input.expected_service_revisions);
    const place = await tx.place.read();
    if (place === null) throw new SessionError('FORBIDDEN');
    const time = packageSaleTime(
      input.sold_at === undefined ? undefined : new Date(input.sold_at),
      at,
      place.timezone,
    );
    const customer = await tx.customer.read(input.customer_id);
    if (customer === null) throw new PackageSaleError('PACKAGE_CUSTOMER_NOT_FOUND');
    const seller = (await tx.performers.read([input.seller_employee_id], time.occurred_at))[0];
    if (seller === undefined) throw new PackageSaleError('PACKAGE_SELLER_NOT_ELIGIBLE');
    checkPackageSeller(seller, context.userId);
    const limit = await tx.discount.read(membershipId);
    const plan = planPackageSale(
      {
        type,
        pricePaid: parseMoney(input.price_paid),
        limitBps: limit.bps,
        companyId: context.companyId,
        businessId: context.businessId,
        branchId: context.branchId,
        customerId: input.customer_id,
        recorderUserId: context.userId,
        recorderMembershipId: membershipId,
        seller,
        paidMethod: input.paid_method,
        soldAt: input.sold_at === undefined ? undefined : new Date(input.sold_at),
        recordedAt: at,
        timezone: place.timezone,
      },
      this.identities(type),
    );
    await tx.insert(plan);
    await tx.audit(plan);
    await tx.emit(plan);
    return saleResponse(plan);
  }

  /** هويات البيع والمكوّنات والجلسات مولّدة قبل الحساب عشان تبقى ثابتة في سجل واحد. */
  private identities(type: SalePackageType): PackageSaleIdentities {
    return {
      saleId: this.ids.newId(),
      components: type.components.map((component) => ({
        serviceId: component.service_id,
        id: this.ids.newId(),
        slots: Array.from({ length: component.sessions }, (_unused, index) => ({
          ordinal: index + 1,
          id: this.ids.newId(),
        })),
      })),
    };
  }
}
