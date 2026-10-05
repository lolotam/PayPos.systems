import { LOG_LEVELS } from '@pospay/observability';
import { z } from 'zod';

// الإعداد الاختياري الفارغ في قالب النشر يعني استخدام الافتراضي، ولا يمنع بدء العامل.
const optionalValue = (value: unknown) => (value === '' ? undefined : value);

// Read once at startup; a missing or malformed value stops the process instead of failing later.
const schema = z.object({
  PLATFORM_NOTIFICATIONS_DATABASE_URL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .url({ protocol: /^postgres(ql)?$/ })
      .optional()
      .catch(undefined),
  ),
  // pospay_app — consumers apply effects inside withTenant(event.company_id).
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  // pospay_dispatcher — reads and marks the outbox across tenants (ADR-0003 §3).
  DISPATCHER_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  WORKER_HOST: z.preprocess(optionalValue, z.string().min(1).default('127.0.0.1')),
  WORKER_PORT: z.preprocess(
    optionalValue,
    z.coerce.number().int().min(1).max(65_535).default(3001),
  ),
  LOG_LEVEL: z.preprocess(optionalValue, z.enum(LOG_LEVELS).default('info')),
});

export type WorkerConfig = z.output<typeof schema>;

/**
 * Parses the worker's environment. The error names the missing keys but never echoes a value — the URLs
 * carry passwords.
 *
 * @param env the process environment
 * @returns the validated configuration
 */
export function readConfig(env: NodeJS.ProcessEnv): WorkerConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid worker configuration: ${keys.join(', ')} — see .env.example`);
  }
  return result.data;
}
