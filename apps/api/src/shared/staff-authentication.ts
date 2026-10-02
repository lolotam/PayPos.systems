import type { StaffDeviceContext, StaffSession } from '@pospay/auth';

export const STAFF_ROUTE = Symbol('STAFF_ROUTE');
export const STAFF_AUTHENTICATION = Symbol('STAFF_AUTHENTICATION');

export interface StaffAuthentication {
  /** يستنتج نشاط الفرع من الجهاز المثبت دون أي مطالبة في الجسم. */
  context(device: {
    companyId: string;
    deviceId: string;
    branchId: string;
  }): Promise<StaffDeviceContext | null>;
  /** يعيد فحص العضويات الفعالة في شركة الجهاز فقط على كل طلب. */
  eligible(userId: string, device: StaffDeviceContext): Promise<boolean>;
}

declare module 'fastify' {
  interface FastifyRequest {
    staffSession?: StaffSession;
    staffDevice?: StaffDeviceContext;
  }
}
