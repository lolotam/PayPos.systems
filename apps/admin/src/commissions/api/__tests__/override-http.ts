import type { CommissionServiceOverrideListItem } from '@pospay/contracts';
// أدوات الـ HTTP العامة موجودة في helper الخطط عشان متتكررش في اختبارات التجاوزات.
import { deferredAnswer, ok, routeGet, type ApiAnswer } from './plan-http';

export const overrideServicesPath =
  '/v1/businesses/{businessId}/employees/{employeeId}/commission-override-services';
export const overridesPath =
  '/v1/businesses/{businessId}/employees/{employeeId}/commission-overrides';

export const SERVICE_A = '01920000-0000-7000-8000-0000000000b3';
export const SERVICE_B = '01920000-0000-7000-8000-0000000000b4';
// مؤشر صفحة خدمات الشاشة معرّف خدمة، فالعملة دي UUID مش نص مفتاح.
export const CURSOR = '01920000-0000-7000-8000-0000000000f1';

/** صف خدمة في جدول الشاشة: الاسم وقاعدة الخدمة وسعرها والتجاوز الحالي. */
export function serviceItem(id: string, overrides: Record<string, unknown> = {}) {
  return {
    service_id: id,
    name_en: `Service ${id.slice(-1)}`,
    name_ar: null,
    closed_at: null,
    service_rule: { kind: 'PCT', value: 1000 },
    price: '10.000',
    current_override: null,
    ...overrides,
  };
}

export function servicePage(items: unknown[], nextCursor: string | null) {
  return { items, next_cursor: nextCursor };
}

/** سطر تجاوز محفوظ، والعلامة `is_current` بتاعت السيرفر نفسها. */
export function overrideItem(
  serviceId: string,
  overrides: Partial<CommissionServiceOverrideListItem> = {},
): CommissionServiceOverrideListItem {
  return {
    id: '01920000-0000-7000-8000-0000000000e1',
    employee_id: '01920000-0000-7c11-8a11-0000000000a1',
    service_id: serviceId,
    rule: { kind: 'PCT', value: 1500 },
    effective_from: '2026-03-01',
    created_at: '2026-03-01T09:00:00Z',
    created_by: '01920000-0000-7c33-8a33-0000000000a3',
    is_current: true,
    ...overrides,
  };
}

export function overridePage(items: unknown[], nextCursor: string | null) {
  return { items, next_cursor: nextCursor };
}

/** جواب حفظ ناجح: السطر المخزّن بعد التحليل مع رد 201. */
export function postOk(data: unknown) {
  return { data, response: { status: 201, ok: true } };
}

/** خدمة «صبغة» بالاسمين، عشان رحلة العمولة الخاصة. */
export const SERVICE_DYE = '01920000-0000-7000-8000-0000000000b6';

export function dyeService(overrides: Record<string, unknown> = {}) {
  return serviceItem(SERVICE_DYE, { name_en: 'Dyeing', name_ar: 'صبغة', ...overrides });
}

export { ok };

interface RouteOptions {
  params?: { path?: Record<string, unknown>; query?: Record<string, unknown> };
}

/** موجِّه بمسارات قابلة للتبديل: كل مسار بيتعامل معاه handler ويقدر يرجع جواب مؤجّل. */
export function makeOverrideRouter(get: Parameters<typeof routeGet>[0]) {
  const routes = new Map<string, (options?: RouteOptions) => Promise<ApiAnswer>>();
  routeGet(get, async (path, options) => {
    const handler = routes.get(path);
    if (handler === undefined) return deferredAnswer().promise;
    return handler(options as RouteOptions | undefined);
  });
  return {
    on(path: string, handler: (options?: RouteOptions) => Promise<ApiAnswer>) {
      routes.set(path, handler);
    },
  };
}
