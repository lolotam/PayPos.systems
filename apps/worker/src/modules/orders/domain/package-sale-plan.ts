import {
  allocatePackagePrice,
  createPackageSlots,
  moneyToString,
  packageExpiryDate,
  validatePackageDefinition,
  type Money,
  type SalePackageType,
} from '@pospay/domain';
import { PackageSaleIdentityInvariantError } from './package-sale-errors.ts';
import { computePackageSalePricing } from './package-sale-pricing.ts';
import {
  checkPackageSeller,
  packageSaleTime,
  type PackageSellerFacts,
} from './package-sale-rules.ts';

/** حقائق البيع المقفولة؛ اختيار التوقيت والأهلية والعضوية من مسؤولية القراء في المعاملة. */
export interface PackageSalePlanInput {
  readonly type: SalePackageType;
  readonly pricePaid: Money;
  readonly limitBps: number | null;
  readonly companyId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly customerId: string;
  readonly recorderUserId: string;
  readonly recorderMembershipId: string;
  readonly seller: PackageSellerFacts;
  readonly paidMethod: 'CASH' | 'CARD';
  readonly soldAt: Date | undefined;
  readonly recordedAt: Date;
  readonly timezone: string;
}

/** الهويات ثابتة من خارج الدومين؛ ربط الجلسة بالخدمة وordinal يمنع اعتماداً خفياً على ترتيب المولد. */
export interface PackageSaleIdentities {
  readonly saleId: string;
  readonly components: readonly {
    readonly serviceId: string;
    readonly id: string;
    readonly slots: readonly { readonly ordinal: number; readonly id: string }[];
  }[];
}

function saleComponentIds(type: SalePackageType, identities: PackageSaleIdentities) {
  const ids = new Map(identities.components.map((identity) => [identity.serviceId, identity]));
  if (
    !identities.saleId ||
    identities.components.length !== type.components.length ||
    ids.size !== type.components.length ||
    new Set(identities.components.map(({ id }) => id)).size !== ids.size ||
    identities.components.some(({ id }) => !id) ||
    type.components.some(({ service_id }) => !ids.has(service_id))
  ) {
    throw new PackageSaleIdentityInvariantError();
  }
  const seenSlots = new Set<string>();
  for (const component of type.components) {
    const identity = ids.get(component.service_id);
    if (
      !identity ||
      identity.slots.length !== component.sessions ||
      new Set(identity.slots.map(({ ordinal }) => ordinal)).size !== component.sessions
    ) {
      throw new PackageSaleIdentityInvariantError();
    }
    for (const slot of identity.slots) {
      if (
        !slot.id ||
        seenSlots.has(slot.id) ||
        !Number.isInteger(slot.ordinal) ||
        slot.ordinal < 1 ||
        slot.ordinal > component.sessions
      ) {
        throw new PackageSaleIdentityInvariantError();
      }
      seenSlots.add(slot.id);
    }
  }
  return ids;
}

function identifiedSlots(
  value: Money,
  sessions: number,
  identity: PackageSaleIdentities['components'][number],
) {
  const ids = new Map(identity.slots.map(({ ordinal, id }) => [ordinal, id]));
  return createPackageSlots(value, sessions).map((slot) => {
    const id = ids.get(slot.ordinal);
    if (!id) throw new PackageSaleIdentityInvariantError();
    return { ...slot, id };
  });
}

function saleComponents(input: PackageSalePlanInput, identities: PackageSaleIdentities) {
  const definitions = input.type.components.map(({ service_id, sessions, service }) => ({
    serviceId: service_id,
    sessions,
    listPriceSnapshot: service.price,
  }));
  validatePackageDefinition(input.type.price, definitions);
  const ids = saleComponentIds(input.type, identities);
  const allocated = allocatePackagePrice(input.pricePaid, definitions);
  return input.type.components.map((snapshot) => {
    const valued = allocated.find(({ serviceId }) => serviceId === snapshot.service_id);
    const identity = ids.get(snapshot.service_id);
    if (!valued || !identity) throw new PackageSaleIdentityInvariantError();
    return {
      id: identity.id,
      service_id: valued.serviceId,
      position: snapshot.position,
      name_en: snapshot.service.name_en,
      name_ar: snapshot.service.name_ar,
      list_price_snapshot: valued.listPriceSnapshot,
      sessions_total: valued.sessions,
      component_value: valued.componentValue,
      slots: identifiedSlots(valued.componentValue, valued.sessions, identity),
    };
  });
}

/**
 * يثبت البيع وقيم الجلسات من لقطة التسجيل، حتى لو تاريخ البيع أقدم؛ لا ساعة ولا مولّد داخل الحساب.
 * رفض العرض القديم يسبق استدعاء الدالة في الكاتب؛ الدالة لا تمنح أي إذن ولا تكتب شيئاً.
 *
 * @param input حقائق النوع والبائعة والحد والفرع والأوقات المحقونة
 * @param identities هويات البيع والمكوّنات والجلسات المولّدة مسبقاً كبيانات ثابتة
 * @returns لقطة مالية بالفلس ومكوّنات بجلساتها، وحدث بيع قابل للتسلسل بلا بيانات عميلة خاصة
 */
export function planPackageSale(input: PackageSalePlanInput, identities: PackageSaleIdentities) {
  const time = packageSaleTime(input.soldAt, input.recordedAt, input.timezone);
  const sellerLinkedUserId = checkPackageSeller(input.seller, input.recorderUserId);
  const components = saleComponents(input, identities);
  const pricing = computePackageSalePricing({
    typePrice: input.type.price,
    pricePaid: input.pricePaid,
    limitBps: input.limitBps,
  });
  const entitlement = {
    id: identities.saleId,
    company_id: input.companyId,
    business_id: input.businessId,
    customer_id: input.customerId,
    package_type_id: input.type.id,
    provenance: 'SOLD' as const,
    name_en: input.type.name_en,
    name_ar: input.type.name_ar,
    validity_days: input.type.validity_days,
    list_price: input.type.price,
    price_paid: input.pricePaid,
    discount: pricing.discount,
    discount_bps: pricing.discountBps,
    paid_method: input.paidMethod,
    seller_employee_id: input.seller.id,
    seller_linked_user_id: sellerLinkedUserId,
    sold_branch_id: input.branchId,
    sold_at: time.occurred_at.toISOString(),
    sold_business_date: time.business_date,
    sold_timezone: input.timezone,
    late: time.late,
    expires_on: packageExpiryDate(time.business_date, input.type.validity_days),
    recorded_by: input.recorderUserId,
    recorded_by_membership_id: input.recorderMembershipId,
    refunded_amount: 0n,
    revision: 1,
    external_ref: null,
    import_batch_id: null,
    import_row: null,
  };
  const event = {
    sale_id: entitlement.id,
    business_id: input.businessId,
    branch_id: input.branchId,
    sold_at: entitlement.sold_at,
    business_date: entitlement.sold_business_date,
    seller_employee_id: input.seller.id,
    price_paid: moneyToString(input.pricePaid),
    refunded_amount: '0.000',
    status: 'SOLD' as const,
    revision: 1,
    schema_version: 1 as const,
  };
  return { entitlement, components, event };
}

/**
 * بيبني أرقام الجلسات المتسلسلة لمكون واحد من 1 لعدد جلساته الأصلية.
 * الترقيم من مسؤولية الدومين وحده، عشان ما يتكررش حساب الأرقام في حالة الاستخدام.
 *
 * @param sessions عدد جلسات المكون الأصلي
 * @returns أرقام الجلسات من 1 إلى sessions بالترتيب
 */
export function packageSaleSlotOrdinals(sessions: number): readonly number[] {
  return Array.from({ length: sessions }, (_, index) => index + 1);
}
