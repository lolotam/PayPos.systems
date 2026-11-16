import type { PackageSalePlanInput } from '../../package-sale-plan.ts';

export const input: PackageSalePlanInput = {
  companyId: 'company',
  businessId: 'business',
  branchId: 'branch',
  customerId: 'customer',
  recorderUserId: 'recorder',
  recorderMembershipId: 'membership',
  paidMethod: 'CASH',
  pricePaid: 22500n,
  limitBps: 1000,
  soldAt: new Date('2026-10-01T08:00:00Z'),
  recordedAt: new Date('2026-10-01T08:00:00Z'),
  timezone: 'Asia/Kuwait',
  seller: {
    id: 'seller',
    user_id: 'seller-user',
    eligible: true,
  },
  type: {
    id: 'type',
    name_en: 'Blow-dry x10',
    name_ar: 'سشوار ×١٠',
    price: 25000n,
    validity_days: 90,
    revision: 1,
    selling_stopped_at: null,
    components: [
      {
        service_id: 'service',
        sessions: 10,
        position: 1,
        service: {
          id: 'service',
          name_en: 'Blow-dry',
          name_ar: 'سشوار',
          price: 3000n,
          revision: 4,
        },
      },
    ],
  },
};
const firstService = input.type.components[0]?.service;
if (!firstService) throw new Error('fixture requires a service');
export const baseService = firstService;
export const identities = {
  saleId: 'sale',
  components: [
    {
      serviceId: 'service',
      id: 'component',
      slots: Array.from({ length: 10 }, (_, index) => ({
        ordinal: index + 1,
        id: 'slot-' + (index + 1),
      })),
    },
  ],
};

/**
 * هويات اختبار ثابتة حسب الخدمة وordinal؛ الترتيب المعكوس يثبت أن الربط بالقيمة لا بالموقع.
 *
 * @param serviceId الخدمة التي تحمل هويات الجلسات
 * @param sessions عدد جلسات المكوّن الأصلي
 * @returns هوية المكوّن وجميع هويات جلساته بترتيب معكوس
 */
export function componentIdentity(serviceId: string, sessions: number) {
  return {
    serviceId,
    id: 'id-' + serviceId,
    slots: Array.from({ length: sessions }, (_, index) => ({
      ordinal: index + 1,
      id: serviceId + '-slot-' + (index + 1),
    })).reverse(),
  };
}
