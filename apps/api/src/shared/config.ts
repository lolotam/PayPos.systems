import { LOG_LEVELS } from '@pospay/observability';
import { z } from 'zod';

// Read once at startup; a missing or malformed value stops the process instead of failing later.
const schema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  // Validated here so an invalid value never reaches pino, whose error message would print it.
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
});

export type ApiConfig = z.output<typeof schema>;

/**
 * Parses the API's environment. The error names the missing keys but never echoes a value — the URLs
 * carry passwords.
 *
 * @param env the process environment
 * @returns the validated configuration
 */
export function readConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const result = schema.safeParse(env);
  if (!result.success) {
    const keys = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid API configuration: ${keys.join(', ')} — see .env.example`);
  }
  return result.data;
}
