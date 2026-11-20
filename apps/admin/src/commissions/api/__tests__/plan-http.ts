import type { Mock } from 'vitest';
import type { CommissionPlanVersion } from '@pospay/contracts';

/** جواب الـ apiClient المؤجّل: الشكل نفسه اللي openapi-fetch بيرجّعه ({data} أو {error, response}). */
export type ApiAnswer = {
  data?: unknown;
  error?: unknown;
  response?: { status: number };
};

export interface DeferredAnswer {
  promise: Promise<ApiAnswer>;
  resolve(answer: ApiAnswer): void;
  reject(error: unknown): void;
}

export function deferredAnswer(): DeferredAnswer {
  let resolve!: (answer: ApiAnswer) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ApiAnswer>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function ok(data: unknown): ApiAnswer {
  return { data };
}

export function refusal(status: number, code: string): ApiAnswer {
  return {
    error: { code, message_ar: 'رسالة تجريبية', message_en: 'Synthetic refusal' },
    response: { status },
  };
}

export const COMPANY = '01920000-0000-7000-8000-0000000000c1';
export const BUSINESS = '01920000-0000-7000-8000-0000000000b2';
export const EMP_A = '01920000-0000-7c11-8a11-0000000000a1';
export const EMP_B = '01920000-0000-7c22-8a22-0000000000a2';
export const USER = '01920000-0000-7c33-8a33-0000000000a3';

export function employeeItem(id: string, number: number, nameAr: string | null, nameEn: string) {
  return { id, name_ar: nameAr, name_en: nameEn, employee_number: number };
}

export function employeePage(
  items: unknown[],
  nextCursor: string | null,
  timeZone = 'Asia/Kuwait',
) {
  return { time_zone: timeZone, items, next_cursor: nextCursor };
}

export function versionItem(
  employeeId: string,
  version: number,
  overrides: Partial<CommissionPlanVersion> = {},
): CommissionPlanVersion {
  return {
    id: `01920000-0000-7000-8000-${String(version).padStart(12, '0')}`,
    employee_id: employeeId,
    version,
    effective_from: '2026-01-01',
    whole_period: false,
    repair_period: null,
    base: { enabled: false },
    tiers: { enabled: false },
    package_sale: { enabled: false },
    created_at: '2026-01-02T09:00:00Z',
    created_by: USER,
    ...overrides,
  } as CommissionPlanVersion;
}

export function versionPage(items: unknown[], nextCursor: number | null) {
  return { items, next_cursor: nextCursor };
}

/** بيوصّل GET الموك بموجِّب بيقرا المسار وباراميترات الاستعلام والمسار من خيارات openapi-fetch. */
export function routeGet(
  get: Mock,
  handler: (
    path: string,
    options?: { params?: { query?: Record<string, unknown>; path?: Record<string, unknown> } },
  ) => Promise<ApiAnswer>,
): void {
  get.mockImplementation(
    (
      path: string,
      options?: { params?: { query?: Record<string, unknown>; path?: Record<string, unknown> } },
    ) => handler(path, options),
  );
}

export const employeesPath = '/v1/businesses/{businessId}/commission-plan-employees';
export const versionsPath =
  '/v1/businesses/{businessId}/employees/{employeeId}/commission-plan-versions';
export const staffEmployeesPath = '/v1/businesses/{businessId}/employees';
