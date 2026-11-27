import type { AuthService } from '@pospay/auth';
import type { TenantWrappers } from '@pospay/db';
import type { Redis } from 'ioredis';

/** مصنع خدمة اختبار بتتبني على قاعدة الاختبار وRedis بتوع الـ harness. */
export type ServiceFactory<T> = (
  auth: AuthService,
  authUrl: string,
  database: TenantWrappers,
  redis: Redis,
) => T;
